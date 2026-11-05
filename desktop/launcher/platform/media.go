package platform

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
)

func (s *Server) BackupToken(ctx context.Context, job string) (string, error) {
	token := ID()
	encrypted, e := Seal(s.Key, []byte(token), job+":backup")
	if e != nil {
		return "", e
	}
	if _, e = s.DB.ExecContext(ctx, "INSERT INTO portal_backup_grants VALUES ($1,$2) ON CONFLICT(job_id) DO NOTHING", job, encrypted); e != nil {
		return "", e
	}
	if e = s.DB.QueryRowContext(ctx, "SELECT token FROM portal_backup_grants WHERE job_id=$1", job).Scan(&encrypted); e != nil {
		return "", e
	}
	raw, e := Open(s.Key, encrypted, job+":backup")
	return string(raw), e
}
func (s *Server) BackupMediaRequested(ctx context.Context, job string) (bool, error) {
	var include bool
	e := s.DB.QueryRowContext(ctx, "SELECT include_media FROM portal_backups WHERE job_id=$1 AND state='running'", job).Scan(&include)
	return include, e
}
func (s *Server) sealMedia(id string, files map[string][]byte) ([]byte, string, error) {
	hashes := map[string]string{}
	for key, data := range files {
		sum := sha256.Sum256(data)
		hashes[key] = hex.EncodeToString(sum[:])
	}
	raw, e := json.Marshal(struct {
		Files     map[string][]byte `json:"files"`
		Checksums map[string]string `json:"checksums"`
	}{files, hashes})
	if e != nil {
		return nil, "", e
	}
	defer func() {
		for i := range raw {
			raw[i] = 0
		}
	}()
	sum := sha256.Sum256(raw)
	encrypted, e := Seal(s.Key, raw, id+":media")
	return encrypted, hex.EncodeToString(sum[:]), e
}
