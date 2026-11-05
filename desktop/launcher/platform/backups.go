package platform

import (
	"context"
	"database/sql"
	"foodtruck.local/desktop/cloudflare"
	"net/http"
)

func (s *Server) backups(w http.ResponseWriter, r *http.Request, customer string) {
	order := r.URL.Query().Get("order")
	includeMedia := false
	if r.Method == "POST" {
		var in struct {
			Order        string `json:"order"`
			IncludeMedia bool   `json:"includeMedia"`
		}
		if !read(w, r, &in) {
			reply(w, 400, map[string]string{"message": "Pedido inválido."})
			return
		}
		order = in.Order
		includeMedia = in.IncludeMedia
	}
	var job string
	if s.DB.QueryRowContext(r.Context(), "SELECT j.id FROM portal_jobs j JOIN portal_orders o ON o.id=j.order_id WHERE o.id=$1 AND o.customer_id=$2 AND j.state='ready'", order, customer).Scan(&job) != nil {
		reply(w, 404, map[string]string{"message": "Instalação indisponível."})
		return
	}
	if r.Method == "POST" {
		_, e := s.DB.ExecContext(r.Context(), "INSERT INTO portal_backups(id,job_id,state,include_media) VALUES ($1,$2,'queued',$3) ON CONFLICT DO NOTHING", ID(), job, includeMedia)
		if e != nil {
			reply(w, 503, map[string]string{"message": "Não foi possível agendar o backup."})
			return
		}
		reply(w, 202, map[string]string{"message": "Backup SQL agendado. A exportação pode interromper brevemente as consultas D1."})
		return
	}
	rows, e := s.DB.QueryContext(r.Context(), "SELECT id,state,coalesce(sha256,''),created_at FROM portal_backups WHERE job_id=$1 ORDER BY created_at DESC LIMIT 50", job)
	if e != nil {
		reply(w, 503, map[string]string{"message": "Consulta indisponível."})
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, state, hash string
		var created any
		if rows.Scan(&id, &state, &hash, &created) != nil {
			reply(w, 503, map[string]string{"message": "Consulta indisponível."})
			return
		}
		items = append(items, map[string]any{"id": id, "state": state, "sha256": hash, "createdAt": created})
	}
	reply(w, 200, items)
}

func (s *Server) RunBackupOne(ctx context.Context, export func(context.Context, string) (cloudflare.SQLBackup, error)) error {
	conn, e := s.DB.Conn(ctx)
	if e != nil {
		return e
	}
	defer conn.Close()
	var locked bool
	if e = conn.QueryRowContext(ctx, "SELECT pg_try_advisory_lock(482019621)").Scan(&locked); e != nil || !locked {
		return e
	}
	defer conn.ExecContext(context.Background(), "SELECT pg_advisory_unlock(482019621)")
	var id, job string
	e = conn.QueryRowContext(ctx, "SELECT id,job_id FROM portal_backups WHERE state IN ('queued','running') ORDER BY created_at LIMIT 1").Scan(&id, &job)
	if e == sql.ErrNoRows {
		return nil
	}
	if e != nil {
		return e
	}
	if _, e = conn.ExecContext(ctx, "UPDATE portal_backups SET state='running' WHERE id=$1", id); e != nil {
		return e
	}
	backup, e := export(ctx, job)
	if e != nil {
		_, e = conn.ExecContext(ctx, "UPDATE portal_backups SET state='failed' WHERE id=$1", id)
		return e
	}
	encrypted, e := Seal(s.Key, backup.SQL, id)
	for i := range backup.SQL {
		backup.SQL[i] = 0
	}
	if e != nil {
		return e
	}

	var include bool
	if e = conn.QueryRowContext(ctx, "SELECT include_media FROM portal_backups WHERE id=$1", id).Scan(&include); e != nil {
		return e
	}
	var media []byte
	var mediaHash string
	if include {
		if backup.Media == nil {
			_, e = conn.ExecContext(ctx, "UPDATE portal_backups SET state='failed' WHERE id=$1", id)
			return e
		}
		media, mediaHash, e = s.sealMedia(id, backup.Media)
		for _, file := range backup.Media {
			for i := range file {
				file[i] = 0
			}
		}
		if e != nil {
			return e
		}
	}
	_, e = conn.ExecContext(ctx, "UPDATE portal_backups SET state='ready',payload=$2,sha256=$3,bookmark=$4,media_payload=$5,media_sha256=$6 WHERE id=$1", id, encrypted, backup.SHA256, backup.Bookmark, media, mediaHash)
	return e
}
