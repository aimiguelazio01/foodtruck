package platform

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"foodtruck.local/desktop/cloudflare"
)

type lifecycleFixture struct {
	db    *sql.DB
	s     *Server
	mails []string
}

func newLifecycle(t *testing.T) *lifecycleFixture {
	f := &lifecycleFixture{db: testDatabase(t)}
	f.s = &Server{DB: f.db, Key: bytes.Repeat([]byte{6}, 32), Origin: "https://portal.test", RetentionDays: 30,
		Mail: func(_ context.Context, to, subject, _ string) error {
			f.mails = append(f.mails, to+"|"+subject)
			return nil
		}}
	return f
}

// order creates a real (non-simulated) managed order. until is an SQL interval relative to now().
func (f *lifecycleFixture) order(t *testing.T, plan, until string, withJob bool) (order, job, email string) {
	t.Helper()
	customer := ID()
	order, job = ID(), ID()
	email = customer[:10] + "@example.test"
	if _, e := f.db.Exec("INSERT INTO portal_customers(id,name,access_hash,email) VALUES ($1,'c',$2,$3)", customer, digest(ID()), email); e != nil {
		t.Fatal(e)
	}
	if _, e := f.db.Exec("INSERT INTO portal_orders(id,customer_id,mode,active_until,simulated,plan_status) VALUES ($1,$2,'platform',now()+$3::interval,false,$4)", order, customer, until, plan); e != nil {
		t.Fatal(e)
	}
	if withJob {
		if _, e := f.db.Exec("INSERT INTO portal_jobs(id,order_id,state) VALUES ($1,$2,'ready')", job, order); e != nil {
			t.Fatal(e)
		}
	}
	return order, job, email
}

func (f *lifecycleFixture) value(t *testing.T, column, order string) string {
	t.Helper()
	var v sql.NullString
	if e := f.db.QueryRow("SELECT ("+column+")::text FROM portal_orders WHERE id=$1", order).Scan(&v); e != nil {
		t.Fatal(e)
	}
	return v.String
}

func TestTrialRemindersAreSentOncePerThreshold(t *testing.T) {
	f := newLifecycle(t)
	soon, _, soonEmail := f.order(t, "trialing", "2 days", false)
	later, _, laterEmail := f.order(t, "trialing", "10 days", false)
	if e := f.s.RunLifecycle(context.Background()); e != nil {
		t.Fatal(e)
	}
	got := strings.Join(f.mails, ",")
	if !strings.Contains(got, soonEmail+"|") || strings.Contains(got, laterEmail) {
		t.Fatalf("wrong recipients: %v", f.mails)
	}
	before := len(f.mails)
	f.s.RunLifecycle(context.Background())
	if len(f.mails) != before {
		t.Fatal("the same reminder was sent twice")
	}
	// With a day left, one more (final) reminder goes out, and only one.
	f.db.Exec("UPDATE portal_orders SET active_until=now()+interval '20 hours' WHERE id=$1", soon)
	f.s.RunLifecycle(context.Background())
	f.s.RunLifecycle(context.Background())
	if len(f.mails) != before+1 {
		t.Fatalf("expected exactly one final reminder: %v", f.mails)
	}
	if f.value(t, "trial_reminder_3 IS NOT NULL", later) != "false" {
		t.Fatal("a trial with plenty of time was marked as reminded")
	}
	// A failed delivery is retried by the next sweep.
	retry, _, _ := f.order(t, "trialing", "20 hours", false)
	f.s.Mail = func(context.Context, string, string, string) error { return errors.New("down") }
	f.s.RunLifecycle(context.Background())
	if f.value(t, "trial_reminder_1 IS NULL", retry) != "true" {
		t.Fatal("a failed reminder was recorded as sent")
	}
}

func TestExpiredOrdersAreSuspendedButPilotOrdersAreNeverTouched(t *testing.T) {
	f := newLifecycle(t)
	expired, _, email := f.order(t, "trialing", "-1 hour", false)
	paidUp, _, _ := f.order(t, "active", "5 days", false)
	pilot, _, _ := f.order(t, "active", "-1 day", false)
	f.db.Exec("UPDATE portal_orders SET simulated=true WHERE id=$1", pilot)
	if e := f.s.RunLifecycle(context.Background()); e != nil {
		t.Fatal(e)
	}
	if f.value(t, "plan_status", expired) != "suspended" || f.value(t, "suspended_at IS NOT NULL", expired) != "true" {
		t.Fatal("expired order not suspended")
	}
	if !strings.Contains(strings.Join(f.mails, ","), email+"|O seu site foi suspenso") {
		t.Fatalf("customer was not told: %v", f.mails)
	}
	if f.value(t, "plan_status", paidUp) != "active" || f.value(t, "plan_status", pilot) != "active" {
		t.Fatal("an order that should keep running was suspended")
	}
	n := len(f.mails)
	f.s.RunLifecycle(context.Background())
	if len(f.mails) != n {
		t.Fatal("suspension notice repeated")
	}
}

func TestRemovalNeedsRetentionAndAFreshBackupAndCanBeCancelledByPaying(t *testing.T) {
	f := newLifecycle(t)
	ctx := context.Background()
	recent, _, _ := f.order(t, "suspended", "-5 days", true)
	f.db.Exec("UPDATE portal_orders SET suspended_at=now()-interval '5 days' WHERE id=$1", recent)
	old, oldJob, _ := f.order(t, "suspended", "-40 days", true)
	f.db.Exec("UPDATE portal_orders SET suspended_at=now()-interval '31 days' WHERE id=$1", old)
	noJob, _, _ := f.order(t, "suspended", "-40 days", false)
	f.db.Exec("UPDATE portal_orders SET suspended_at=now()-interval '31 days' WHERE id=$1", noJob)

	if e := f.s.RunLifecycle(ctx); e != nil {
		t.Fatal(e)
	}
	if f.value(t, "teardown_state", old) != "" {
		t.Fatal("removal queued without a backup")
	}
	var pending int
	f.db.QueryRow("SELECT count(*) FROM portal_backups WHERE job_id=$1 AND state='queued' AND include_media", oldJob).Scan(&pending)
	if pending != 1 {
		t.Fatalf("expected one queued backup with images, got %d", pending)
	}
	f.s.RunLifecycle(ctx)
	f.db.QueryRow("SELECT count(*) FROM portal_backups WHERE job_id=$1", oldJob).Scan(&pending)
	if pending != 1 {
		t.Fatal("a second backup was queued while one is pending")
	}
	// A backup from before the suspension does not count.
	f.db.Exec("UPDATE portal_backups SET state='ready',created_at=now()-interval '40 days' WHERE job_id=$1", oldJob)
	f.s.RunLifecycle(ctx)
	if f.value(t, "teardown_state", old) != "" {
		t.Fatal("a stale backup allowed removal")
	}
	f.db.Exec("UPDATE portal_backups SET state='ready',created_at=now() WHERE job_id=$1 AND state='queued'", oldJob)
	f.s.RunLifecycle(ctx)
	if f.value(t, "teardown_state", old) != "queued" {
		t.Fatal("removal not queued after a fresh backup")
	}
	if f.value(t, "teardown_state", recent) != "" || f.value(t, "teardown_state", noJob) != "" {
		t.Fatal("removal queued too early or for an order with nothing installed")
	}

	// A failure is retried later; storage still emptying is retried later too.
	calls := 0
	run := func(err error) func(context.Context, string) error {
		return func(_ context.Context, job string) error {
			calls++
			if job != oldJob {
				t.Fatalf("wrong installation: %s", job)
			}
			return err
		}
	}
	if e := f.s.RunTeardownOne(ctx, run(cloudflare.ErrStoragePending)); e != nil {
		t.Fatal(e)
	}
	if f.value(t, "teardown_state", old) != "queued" || f.value(t, "teardown_retry_at > now()", old) != "true" {
		t.Fatal("pending storage was not rescheduled")
	}
	f.s.RunTeardownOne(ctx, run(nil))
	if calls != 1 {
		t.Fatal("retried before the retry time")
	}
	f.db.Exec("UPDATE portal_orders SET teardown_retry_at=NULL WHERE id=$1", old)
	f.s.RunTeardownOne(ctx, run(errors.New("boom")))
	if f.value(t, "teardown_state", old) != "queued" || calls != 2 {
		t.Fatal("a failed removal was not kept for retry")
	}

	// Paying again before removal cancels it.
	f.db.Exec("UPDATE portal_orders SET teardown_retry_at=NULL WHERE id=$1", old)
	f.db.Exec("UPDATE portal_orders SET plan_status='active',suspended_at=NULL,active_until=now()+interval '30 days' WHERE id=$1", old)
	f.s.RunTeardownOne(ctx, run(nil))
	if calls != 2 {
		t.Fatal("a customer who paid again was still removed")
	}

	// Finally, a suspended order is removed and its address freed.
	f.db.Exec("UPDATE portal_orders SET plan_status='suspended',suspended_at=now()-interval '31 days',teardown_state='queued' WHERE id=$1", old)
	f.db.Exec("INSERT INTO portal_slugs(slug,order_id) VALUES ($1,$2)", "gone-"+strings.ToLower(ID()[:6]), old)
	if e := f.s.RunTeardownOne(ctx, run(nil)); e != nil || calls != 3 {
		t.Fatalf("removal did not run: %v calls=%d", e, calls)
	}
	var slugs int
	f.db.QueryRow("SELECT count(*) FROM portal_slugs WHERE order_id=$1", old).Scan(&slugs)
	if f.value(t, "teardown_state", old) != "done" || slugs != 0 {
		t.Fatal("removal not recorded or address not released")
	}
	var state string
	f.db.QueryRow("SELECT state FROM portal_jobs WHERE id=$1", oldJob).Scan(&state)
	if state != "cancelled" {
		t.Fatalf("job state %q", state)
	}
	f.s.RunTeardownOne(ctx, run(nil))
	if calls != 3 {
		t.Fatal("a finished removal ran again")
	}
}

func TestCapacityLimitStopsNewInstallationsOnly(t *testing.T) {
	f := newLifecycle(t)
	f.s.MaxInstallations = 1
	f.db.Exec("DELETE FROM portal_slugs")
	limitBefore := func() int {
		var n int
		f.db.QueryRow("SELECT count(*) FROM portal_jobs j JOIN portal_orders o ON o.id=j.order_id WHERE o.mode='platform' AND j.state<>'cancelled'").Scan(&n)
		return n
	}
	used := limitBefore()
	f.s.MaxInstallations = used + 1
	access := ID()
	customer, first, second := ID(), ID(), ID()
	f.db.Exec("INSERT INTO portal_customers(id,name,access_hash,email) VALUES ($1,'c',$2,$3)", customer, digest(access), customer+"@example.test")
	for _, id := range []string{first, second} {
		if _, e := f.db.Exec("INSERT INTO portal_orders(id,customer_id,mode,active_until,simulated) VALUES ($1,$2,'platform',now()+interval '1 day',false)", id, customer); e != nil {
			t.Fatal(e)
		}
	}
	install := func(order string) int {
		r := httptest.NewRequest(http.MethodPost, "/install", strings.NewReader(`{"order":"`+order+`","business":{"name":"T"},"costsApproved":true}`))
		r.Header.Set("Origin", f.s.Origin)
		r.Header.Set("Authorization", "Bearer "+access)
		w := httptest.NewRecorder()
		f.s.ServeHTTP(w, r)
		return w.Code
	}
	if install(first) != 202 {
		t.Fatal("installation below the limit refused")
	}
	if install(second) != 503 {
		t.Fatal("installation above the limit accepted")
	}
	if install(first) != 202 {
		t.Fatal("repeating an accepted installation must not be blocked by the limit")
	}
}
