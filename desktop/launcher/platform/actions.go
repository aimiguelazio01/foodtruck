package platform

import (
	"database/sql"
	"net/http"
)

// Job actions serialize with the runner's advisory lock. A running deployment
// must finish its current safe operation before a cancellation is accepted.
func (s *Server) jobAction(w http.ResponseWriter, r *http.Request, customer string) {
	var in struct {
		Order  string `json:"order"`
		Action string `json:"action"`
	}
	if !read(w, r, &in) || (in.Action != "resume" && in.Action != "cancel") {
		reply(w, 400, map[string]string{"message": "Ação inválida."})
		return
	}
	tx, e := s.DB.BeginTx(r.Context(), nil)
	if e != nil {
		reply(w, 503, map[string]string{"message": "Serviço indisponível."})
		return
	}
	defer tx.Rollback()
	var locked bool
	if tx.QueryRowContext(r.Context(), "SELECT pg_try_advisory_xact_lock(482019621)").Scan(&locked) != nil || !locked {
		reply(w, 409, map[string]string{"message": "Uma instalação está em curso. Aguarde antes de repetir."})
		return
	}
	var id, state string
	var active bool
	e = tx.QueryRowContext(r.Context(), `SELECT j.id,j.state,o.active_until>now() FROM portal_jobs j JOIN portal_orders o ON o.id=j.order_id WHERE o.id=$1 AND o.customer_id=$2 FOR UPDATE OF j,o`, in.Order, customer).Scan(&id, &state, &active)
	if e == sql.ErrNoRows {
		reply(w, 404, map[string]string{"message": "Instalação indisponível."})
		return
	}
	if e != nil {
		reply(w, 503, map[string]string{"message": "Consulta indisponível."})
		return
	}
	next := "cancelled"
	if in.Action == "resume" {
		next = "queued"
		if !active || (state != "blocked" && state != "cancelled") {
			reply(w, 409, map[string]string{"message": "Esta instalação não pode ser retomada."})
			return
		}
	} else if state == "ready" {
		reply(w, 409, map[string]string{"message": "A aplicação já está publicada."})
		return
	}
	_, e = tx.ExecContext(r.Context(), "UPDATE portal_jobs SET state=$2,message='',updated_at=now() WHERE id=$1 AND payload IS NOT NULL", id, next)
	if e == nil {
		_, e = tx.ExecContext(r.Context(), "INSERT INTO portal_audit(id,actor,action,target) VALUES ($1,$2,$3,$4)", ID(), customer, in.Action, id)
	}
	if e == nil {
		e = tx.Commit()
	}
	if e != nil {
		reply(w, 503, map[string]string{"message": "Não foi possível atualizar a instalação."})
		return
	}
	reply(w, 200, map[string]string{"state": next})
}

func (s *Server) adminOrders(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		rows, e := s.DB.QueryContext(r.Context(), `SELECT o.id,c.name,o.mode,o.active_until,coalesce(j.state,'new'),o.plan_status,o.trial_ends_at FROM portal_orders o JOIN portal_customers c ON c.id=o.customer_id LEFT JOIN portal_jobs j ON j.order_id=o.id ORDER BY o.id`)
		if e != nil {
			reply(w, 503, map[string]string{"message": "Consulta indisponível."})
			return
		}
		defer rows.Close()
		items := []map[string]any{}
		for rows.Next() {
			var id, name, mode, state string
			var until any
			var plan string
			var trialEnds sql.NullTime
			if rows.Scan(&id, &name, &mode, &until, &state, &plan, &trialEnds) != nil {
				reply(w, 503, map[string]string{"message": "Consulta indisponível."})
				return
			}
			items = append(items, map[string]any{"id": id, "name": name, "mode": mode, "activeUntil": until, "state": state, "planStatus": plan, "trialEndsAt": trialEnds.Time})
		}
		if rows.Err() != nil {
			reply(w, 503, map[string]string{"message": "Consulta indisponível."})
			return
		}
		reply(w, 200, items)
		return
	}
	reply(w, 405, map[string]string{"message": "Método indisponível."})
}
