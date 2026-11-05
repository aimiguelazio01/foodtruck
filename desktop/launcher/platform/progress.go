package platform

import (
	"context"
	"errors"
	"slices"
)

func (s *Server) RecordProgress(ctx context.Context, id, step string) error {
	if !slices.Contains([]string{"verify-package", "provision-storage", "configure-business", "publish-api", "publish-customer", "publish-management", "attach-domain", "verify-application"}, step) {
		return errors.New("invalid progress step")
	}
	result, e := s.DB.ExecContext(ctx, "UPDATE portal_jobs SET step=$2,updated_at=now() WHERE id=$1 AND state='running'", id, step)
	if e != nil {
		return e
	}
	n, e := result.RowsAffected()
	if e != nil {
		return e
	}
	if n != 1 {
		return errors.New("installation is no longer running")
	}
	return nil
}
