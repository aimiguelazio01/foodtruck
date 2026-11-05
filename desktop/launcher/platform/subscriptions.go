package platform

import (
	"context"
	"database/sql"
	"net/http"
	"strings"
	"time"
)

func (s *Server) hostingStatus(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if len(token) != 48 {
		reply(w, 401, map[string]string{"message": "Autorização necessária."})
		return
	}
	var active bool
	e := s.DB.QueryRowContext(r.Context(), `SELECT o.active_until>now() FROM portal_orders o JOIN portal_hosting_grants g ON g.order_id=o.id WHERE g.token_hash=$1 AND o.mode='platform'`, digest(token)).Scan(&active)
	if e != nil {
		reply(w, 503, map[string]string{"message": "Estado de alojamento indisponível."})
		return
	}
	reply(w, 200, map[string]bool{"active": active})
}

// JobSlug returns the public address label reserved for a job's order, or "" when none was chosen.
func (s *Server) JobSlug(ctx context.Context, job string) (string, error) {
	var slug string
	err := s.DB.QueryRowContext(ctx, "SELECT s.slug FROM portal_slugs s JOIN portal_jobs j ON j.order_id=s.order_id WHERE j.id=$1", job).Scan(&slug)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return slug, err
}

// HostingGrant is called only by the trusted runner. Concurrent calls retain the
// same credential so retries never change the deployed Worker metadata.
func (s *Server) HostingGrant(ctx context.Context, job string) (string, error) {
	var order string
	if e := s.DB.QueryRowContext(ctx, "SELECT o.id FROM portal_orders o JOIN portal_jobs j ON j.order_id=o.id WHERE j.id=$1 AND o.mode='platform'", job).Scan(&order); e != nil {
		return "", e
	}
	token := ID()
	encrypted, e := Seal(s.Key, []byte(token), order)
	if e != nil {
		return "", e
	}
	_, e = s.DB.ExecContext(ctx, "INSERT INTO portal_hosting_grants VALUES ($1,$2,$3) ON CONFLICT(order_id) DO NOTHING", order, digest(token), encrypted)
	if e != nil {
		return "", e
	}
	if e = s.DB.QueryRowContext(ctx, "SELECT token FROM portal_hosting_grants WHERE order_id=$1", order).Scan(&encrypted); e != nil {
		return "", e
	}
	raw, e := Open(s.Key, encrypted, order)
	return string(raw), e
}

func (s *Server) subscriptionAction(w http.ResponseWriter, r *http.Request, actor string, admin bool) {
	var in struct {
		Order  string `json:"order"`
		Action string `json:"action"`
	}
	if !read(w, r, &in) || (in.Action != "cancel" && in.Action != "reactivate") {
		reply(w, 400, map[string]string{"message": "Ação inválida."})
		return
	}
	if in.Action == "reactivate" && !admin {
		reply(w, 403, map[string]string{"message": "A reativação do piloto exige o operador."})
		return
	}
	tx, e := s.DB.BeginTx(r.Context(), nil)
	if e != nil {
		reply(w, 503, map[string]string{"message": "Serviço indisponível."})
		return
	}
	defer tx.Rollback()
	var until time.Time
	var mode, customer string
	e = tx.QueryRowContext(r.Context(), "SELECT mode,customer_id,active_until FROM portal_orders WHERE id=$1 FOR UPDATE", in.Order).Scan(&mode, &customer, &until)
	if e != nil || mode != "platform" || (!admin && customer != actor) {
		reply(w, 404, map[string]string{"message": "Subscrição indisponível."})
		return
	}
	if in.Action == "cancel" {
		_, e = tx.ExecContext(r.Context(), "UPDATE portal_orders SET cancel_requested=true WHERE id=$1", in.Order)
	} else {
		_, e = tx.ExecContext(r.Context(), "UPDATE portal_orders SET cancel_requested=false,plan_status=CASE WHEN active_until<now() THEN 'active' ELSE plan_status END,suspended_at=CASE WHEN active_until<now() THEN NULL ELSE suspended_at END,teardown_state=CASE WHEN teardown_state='queued' THEN '' ELSE teardown_state END,active_until=CASE WHEN active_until<now() THEN now()+interval '30 days' ELSE active_until END WHERE id=$1", in.Order)
	}
	if e == nil {
		_, e = tx.ExecContext(r.Context(), "INSERT INTO portal_audit VALUES ($1,$2,$3,$4,now())", ID(), actor, "subscription-"+in.Action, in.Order)
	}
	if e == nil {
		e = tx.Commit()
	}
	if e != nil {
		reply(w, 503, map[string]string{"message": "Não foi possível atualizar a subscrição."})
		return
	}
	reply(w, 200, map[string]string{"message": "Subscrição atualizada. O cancelamento respeita o fim do período; os dados são preservados."})
}
