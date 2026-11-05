package cloudflare

import (
	"context"
	_ "embed"
	"errors"
	"net/http"
)

//go:embed restore-session-reset.sql
var restoreSessionReset string

func (c *Client) clearRestoredSessions(ctx context.Context, account, database string) error {
	var result []struct {
		Success bool `json:"success"`
	}
	if _, e := c.request(ctx, http.MethodPost, "/accounts/"+account+"/d1/database/"+database+"/query", map[string]any{"sql": restoreSessionReset, "params": []any{}}, &result); e != nil {
		return e
	}
	if len(result) != 7 {
		return errors.New("restored session reset could not be verified")
	}
	for _, statement := range result {
		if !statement.Success {
			return errors.New("restored session reset failed")
		}
	}
	return nil
}
