package platform

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"foodtruck.local/desktop/cloudflare"
	"net/http"
	"regexp"
)

func (s *Server) restores(w http.ResponseWriter, r *http.Request, customer string) {
	if r.Method == "POST" {
		var in struct {
			Backup        string `json:"backup"`
			CostsApproved bool   `json:"costsApproved"`
		}
		if !read(w, r, &in) || !in.CostsApproved {
			reply(w, 400, map[string]string{"message": "Confirme a criação de uma base D1 separada e os custos aplicáveis."})
			return
		}
		result, e := s.DB.ExecContext(r.Context(), `INSERT INTO portal_restore_checks(id,backup_id,state) SELECT $1,b.id,'queued' FROM portal_backups b JOIN portal_jobs j ON j.id=b.job_id JOIN portal_orders o ON o.id=j.order_id WHERE b.id=$2 AND b.state='ready' AND o.customer_id=$3 ON CONFLICT(backup_id) DO UPDATE SET state='queued' WHERE portal_restore_checks.state='failed'`, ID(), in.Backup, customer)
		if e != nil {
			reply(w, 503, map[string]string{"message": "Não foi possível agendar a validação."})
			return
		}
		n, _ := result.RowsAffected()
		if n == 0 {
			reply(w, 409, map[string]string{"message": "Backup indisponível ou já tem uma validação registada."})
			return
		}
		reply(w, 202, map[string]string{"message": "Validação agendada numa base separada. A aplicação em uso mantém a base atual."})
		return
	}
	rows, e := s.DB.QueryContext(r.Context(), `SELECT v.id,v.backup_id,v.state,v.progress FROM portal_restore_checks v JOIN portal_backups b ON b.id=v.backup_id JOIN portal_jobs j ON j.id=b.job_id JOIN portal_orders o ON o.id=j.order_id WHERE o.customer_id=$1 ORDER BY v.created_at DESC LIMIT 50`, customer)
	if e != nil {
		reply(w, 503, map[string]string{"message": "Consulta indisponível."})
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, backup, state string
		var progress cloudflare.RestoreCopy
		if rows.Scan(&id, &backup, &state, newJSON(&progress)) != nil {
			reply(w, 503, map[string]string{"message": "Consulta indisponível."})
			return
		}
		items = append(items, map[string]any{"id": id, "backup": backup, "state": state, "databaseId": progress.DatabaseID, "mediaBucket": progress.MediaBucket, "mediaVerified": progress.MediaVerified, "packageVersion": progress.PackageVersion, "schemaVerified": progress.SchemaVerified})
	}
	reply(w, 200, items)
}

// Decode jsonb without exposing internal recovery metadata to clients.
type jsonScanner struct{ target any }

func newJSON(target any) *jsonScanner { return &jsonScanner{target} }
func (s *jsonScanner) Scan(src any) error {
	switch v := src.(type) {
	case []byte:
		return json.Unmarshal(v, s.target)
	case string:
		return json.Unmarshal([]byte(v), s.target)
	}
	return sql.ErrNoRows
}

type RestoreValidator func(context.Context, string, string, []byte, string, cloudflare.RestoreCopy, func(cloudflare.RestoreCopy) error) (cloudflare.RestoreCopy, error)

func (s *Server) RunRestoreOne(ctx context.Context, validate RestoreValidator) error {
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
	var id, backup, job, checksum string
	var data []byte
	var progress cloudflare.RestoreCopy
	e = conn.QueryRowContext(ctx, `SELECT v.id,b.id,b.job_id,b.payload,b.sha256,v.progress FROM portal_restore_checks v JOIN portal_backups b ON b.id=v.backup_id WHERE v.state IN ('queued','running') ORDER BY v.created_at LIMIT 1`).Scan(&id, &backup, &job, &data, &checksum, newJSON(&progress))
	if e == sql.ErrNoRows {
		return nil
	}
	if e != nil {
		return e
	}
	if _, e = conn.ExecContext(ctx, "UPDATE portal_restore_checks SET state='running' WHERE id=$1", id); e != nil {
		return e
	}
	clear, e := Open(s.Key, data, backup)
	if e != nil {
		_, err := conn.ExecContext(ctx, "UPDATE portal_restore_checks SET state='failed' WHERE id=$1", id)
		return err
	}
	defer func() {
		for i := range clear {
			clear[i] = 0
		}
	}()
	save := func(next cloudflare.RestoreCopy) error {
		raw, e := json.Marshal(next)
		if e != nil {
			return e
		}
		_, e = conn.ExecContext(ctx, "UPDATE portal_restore_checks SET progress=$2 WHERE id=$1", id, string(raw))
		return e
	}
	var include bool
	var mediaEncrypted []byte
	var mediaHash string
	if e = conn.QueryRowContext(ctx, "SELECT include_media,media_payload,coalesce(media_sha256,'') FROM portal_backups WHERE id=$1", backup).Scan(&include, &mediaEncrypted, &mediaHash); e != nil {
		return e
	}
	var files map[string][]byte
	if include {
		files, e = s.readMediaArchive(backup, mediaEncrypted, mediaHash)
		if e != nil || s.RestoreImages == nil {
			_, e = conn.ExecContext(ctx, "UPDATE portal_restore_checks SET state='failed' WHERE id=$1", id)
			return e
		}
		defer func() {
			for _, data := range files {
				for i := range data {
					data[i] = 0
				}
			}
		}()
	}
	result, e := validate(ctx, job, id, clear, checksum, progress, save)
	if e == nil && result.Verified && include {
		result, e = s.RestoreImages(ctx, job, id, files, result, save)
	}

	state := "failed"
	if e == nil && result.Verified && (!include || result.MediaVerified && result.MediaWorkerDeleted) {
		state = "verified"
	}
	_, e = conn.ExecContext(ctx, "UPDATE portal_restore_checks SET state=$2 WHERE id=$1", id, state)
	return e
}

var restoredImageKey = regexp.MustCompile(`^uploads/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.webp$`)

func (s *Server) readMediaArchive(backup string, encrypted []byte, checksum string) (map[string][]byte, error) {
	raw, e := Open(s.Key, encrypted, backup+":media")
	if e != nil {
		return nil, e
	}
	defer func() {
		for i := range raw {
			raw[i] = 0
		}
	}()
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != checksum {
		return nil, errors.New("media archive checksum mismatch")
	}
	var archive struct {
		Files     map[string][]byte `json:"files"`
		Checksums map[string]string `json:"checksums"`
	}
	if json.Unmarshal(raw, &archive) != nil || archive.Files == nil || len(archive.Files) != len(archive.Checksums) {
		return nil, errors.New("invalid media archive")
	}
	for key, data := range archive.Files {
		if !restoredImageKey.MatchString(key) || len(data) > 8<<20 {
			return nil, errors.New("unsupported restored image")
		}
		sum := sha256.Sum256(data)
		if archive.Checksums[key] != hex.EncodeToString(sum[:]) {
			return nil, errors.New("image checksum mismatch")
		}
	}
	return archive.Files, nil
}
