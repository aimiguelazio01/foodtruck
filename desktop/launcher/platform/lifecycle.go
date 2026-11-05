package platform

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"

	"foodtruck.local/desktop/cloudflare"
)

// Lifecycle of a self-service installation:
//
//	trialing/active -> (period ends) -> suspended -> (retention days, fresh backup) -> teardown queued -> removed
//
// Only real orders take part (simulated = false). Operator-created pilot orders are never suspended
// or removed automatically.

const defaultRetentionDays = 30

func (s *Server) retentionDays() int {
	if s.RetentionDays > 0 {
		return s.RetentionDays
	}
	return defaultRetentionDays
}

type notice struct{ id, email string }

// collect runs a statement that RETURNs (id, email) rows and closes the cursor before returning.
func (s *Server) collect(ctx context.Context, query string, args ...any) ([]notice, error) {
	rows, err := s.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var found []notice
	for rows.Next() {
		var n notice
		if err := rows.Scan(&n.id, &n.email); err != nil {
			return nil, err
		}
		found = append(found, n)
	}
	return found, rows.Err()
}

// RunLifecycle performs one idempotent sweep. Call it every few minutes.
func (s *Server) RunLifecycle(ctx context.Context) error {
	var failures []error
	for _, step := range []func(context.Context) error{
		func(c context.Context) error { return s.remindTrials(c, 3) },
		func(c context.Context) error { return s.remindTrials(c, 1) },
		s.suspendExpired,
		s.queueTeardowns,
	} {
		if err := step(ctx); err != nil {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}

func (s *Server) tell(ctx context.Context, n notice, subject, text string) error {
	if n.email == "" || !s.MailReady() {
		return nil // admin-created accounts have no email; nothing to send
	}
	return s.sendMail(ctx, n.email, subject, text)
}

// remindTrials mails each trial once when it has `days` days (or fewer) left. The claim is atomic, and a
// failed delivery releases it so the next sweep retries.
func (s *Server) remindTrials(ctx context.Context, days int) error {
	column := "trial_reminder_3"
	claim := "trial_reminder_3=now()"
	if days == 1 {
		column = "trial_reminder_1"
		claim = "trial_reminder_1=now(),trial_reminder_3=coalesce(o.trial_reminder_3,now())"
	}
	found, err := s.collect(ctx, `UPDATE portal_orders o SET `+claim+` FROM portal_customers c
		WHERE c.id=o.customer_id AND o.mode='platform' AND NOT o.simulated AND o.plan_status='trialing'
		AND o.active_until>now() AND o.active_until<=now()+make_interval(days => $1::int) AND o.`+column+` IS NULL
		RETURNING o.id,coalesce(c.email,'')`, days)
	if err != nil {
		return err
	}
	var failures []error
	for _, n := range found {
		text := fmt.Sprintf("O período de teste gratuito do seu Food Truck Live termina dentro de %d dia(s).\n\nSubscreva em %s para manter o site online e os seus dados. Se não subscrever, o site é suspenso e os dados ficam guardados durante %d dias.",
			days, s.Origin, s.retentionDays())
		if e := s.tell(ctx, n, "O seu teste gratuito está a terminar — Food Truck Live", text); e != nil {
			failures = append(failures, e)
			_, _ = s.DB.ExecContext(ctx, "UPDATE portal_orders SET trial_reminder_3=NULL,trial_reminder_1=NULL WHERE id=$1", n.id)
		}
	}
	return errors.Join(failures...)
}

// suspendExpired marks orders whose paid or trial period (plus grace) has ended. The hosting gate already
// answers 402 for them; this records the state, starts the retention clock and tells the customer.
func (s *Server) suspendExpired(ctx context.Context) error {
	found, err := s.collect(ctx, `UPDATE portal_orders o SET plan_status='suspended',suspended_at=now() FROM portal_customers c
		WHERE c.id=o.customer_id AND o.mode='platform' AND NOT o.simulated AND o.plan_status<>'suspended' AND o.active_until<=now()
		RETURNING o.id,coalesce(c.email,'')`)
	if err != nil {
		return err
	}
	for _, n := range found {
		text := fmt.Sprintf("O seu site Food Truck Live foi suspenso porque o período contratado terminou.\n\nOs seus dados ficam guardados durante %d dias. Subscreva em %s para reativar o site de imediato. Passado esse prazo, o site e os dados são removidos.",
			s.retentionDays(), s.Origin)
		if e := s.tell(ctx, n, "O seu site foi suspenso — Food Truck Live", text); e != nil {
			log.Print("Suspension notice could not be sent")
		}
	}
	return nil
}

// queueTeardowns takes a final backup of every installation that stayed suspended for the whole retention
// period, and queues its removal only once that backup is ready. No backup, no removal.
func (s *Server) queueTeardowns(ctx context.Context) error {
	rows, err := s.DB.QueryContext(ctx, `SELECT o.id,j.id,
		EXISTS (SELECT 1 FROM portal_backups b WHERE b.job_id=j.id AND b.state='ready' AND b.created_at>=o.suspended_at)
		FROM portal_orders o JOIN portal_jobs j ON j.order_id=o.id
		WHERE o.mode='platform' AND NOT o.simulated AND o.plan_status='suspended' AND o.teardown_state=''
		AND o.suspended_at<=now()-make_interval(days => $1::int) AND j.state='ready'`, s.retentionDays())
	if err != nil {
		return err
	}
	type candidate struct {
		order, job string
		backedUp   bool
	}
	var list []candidate
	for rows.Next() {
		var c candidate
		if err := rows.Scan(&c.order, &c.job, &c.backedUp); err != nil {
			rows.Close()
			return err
		}
		list = append(list, c)
	}
	rows.Close()
	for _, c := range list {
		if c.backedUp {
			if _, err := s.DB.ExecContext(ctx, "UPDATE portal_orders SET teardown_state='queued' WHERE id=$1 AND plan_status='suspended' AND teardown_state=''", c.order); err != nil {
				return err
			}
			continue
		}
		// Includes the images. The unique index keeps this to a single pending backup per installation.
		if _, err := s.DB.ExecContext(ctx, "INSERT INTO portal_backups(id,job_id,state,include_media) VALUES ($1,$2,'queued',true) ON CONFLICT DO NOTHING", ID(), c.job); err != nil {
			return err
		}
	}
	return nil
}

// RunTeardownOne removes one queued installation through run (the Cloudflare engine). It shares the
// runner lock with installs and backups, so only one of them works at a time.
func (s *Server) RunTeardownOne(ctx context.Context, run func(ctx context.Context, job string) error) error {
	conn, err := s.DB.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	var locked bool
	if err = conn.QueryRowContext(ctx, "SELECT pg_try_advisory_lock(482019621)").Scan(&locked); err != nil || !locked {
		return err
	}
	defer conn.ExecContext(context.Background(), "SELECT pg_advisory_unlock(482019621)")
	// Holding the lock means any 'running' removal was interrupted by a crash.
	if _, err = conn.ExecContext(ctx, "UPDATE portal_orders SET teardown_state='queued' WHERE teardown_state='running'"); err != nil {
		return err
	}
	var order, job string
	err = conn.QueryRowContext(ctx, `SELECT o.id,j.id FROM portal_orders o JOIN portal_jobs j ON j.order_id=o.id
		WHERE o.teardown_state='queued' AND o.plan_status='suspended' AND (o.teardown_retry_at IS NULL OR o.teardown_retry_at<=now())
		ORDER BY o.suspended_at LIMIT 1`).Scan(&order, &job)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	if _, err = conn.ExecContext(ctx, "UPDATE portal_orders SET teardown_state='running' WHERE id=$1", order); err != nil {
		return err
	}
	runErr := run(ctx, job)
	switch {
	case runErr == nil:
		tx, err := s.DB.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		for _, statement := range []string{
			"UPDATE portal_orders SET teardown_state='done' WHERE id=$1",
			"UPDATE portal_jobs SET state='cancelled',message='Instalação removida após o período de retenção.',updated_at=now() WHERE order_id=$1",
			"DELETE FROM portal_slugs WHERE order_id=$1", // the address becomes available again
		} {
			if _, err = tx.ExecContext(ctx, statement, order); err != nil {
				return err
			}
		}
		if _, err = tx.ExecContext(ctx, "INSERT INTO portal_audit(id,actor,action,target) VALUES ($1,'lifecycle','teardown',$2)", ID(), order); err != nil {
			return err
		}
		return tx.Commit()
	case errors.Is(runErr, cloudflare.ErrStoragePending):
		_, err = conn.ExecContext(ctx, "UPDATE portal_orders SET teardown_state='queued',teardown_retry_at=now()+interval '6 hours' WHERE id=$1", order)
	default:
		log.Print("Installation removal failed and will be retried")
		_, err = conn.ExecContext(ctx, "UPDATE portal_orders SET teardown_state='queued',teardown_retry_at=now()+interval '1 hour' WHERE id=$1", order)
	}
	return err
}

// installationCapacityReached reports whether another managed installation may be started. MaxInstallations
// is the operator's own limit, chosen from the Cloudflare account's quotas; zero means no limit.
func (s *Server) installationCapacityReached(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}) (bool, error) {
	if s.MaxInstallations <= 0 {
		return false, nil
	}
	var used int
	if err := q.QueryRowContext(ctx, `SELECT count(*) FROM portal_jobs j JOIN portal_orders o ON o.id=j.order_id
		WHERE o.mode='platform' AND j.state<>'cancelled'`).Scan(&used); err != nil {
		return false, err
	}
	if used*10 >= s.MaxInstallations*8 {
		log.Printf("Managed installations at %d of %d", used, s.MaxInstallations)
	}
	return used >= s.MaxInstallations, nil
}
