package cloudflare

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
)

type SQLBackup struct {
	Media    map[string][]byte
	SQL      []byte
	SHA256   string
	Bookmark string
}

// ExportSQLFromJournal validates resource ownership and keeps the installation
// lock while Cloudflare's official export protocol completes.
func (c *Client) ExportSQLFromJournal(ctx context.Context, directory, account string) (SQLBackup, error) {
	var backup SQLBackup
	_, err := withJournal(directory, account, false, func(state ProvisionState, save func(ProvisionState) error) (ProvisionState, error) {
		if !state.BootstrapCompleted || state.DatabaseID == "" || state.Workers["api"] == "" {
			return state, errors.New("installation is not ready for backup")
		}
		tags, exists, e := c.workerTags(ctx, account, state.Name+"-api")
		if e != nil {
			return state, e
		}
		if !exists || !slices.Contains(tags, state.Workers["api"]) {
			return state, errors.New("backup ownership could not be verified")
		}
		body := map[string]any{"output_format": "polling"}
		bookmark := ""
		for attempt := 0; attempt < 120; attempt++ {
			var result struct {
				Status   string `json:"status"`
				Bookmark string `json:"at_bookmark"`
				Result   struct {
					URL string `json:"signed_url"`
				} `json:"result"`
			}
			if _, e = c.request(ctx, http.MethodPost, "/accounts/"+account+"/d1/database/"+state.DatabaseID+"/export", body, &result); e != nil {
				return state, e
			}
			if result.Status == "error" {
				return state, errors.New("Cloudflare SQL export failed")
			}
			if result.Bookmark != "" {
				if bookmark != "" && bookmark != result.Bookmark {
					return state, errors.New("export bookmark changed")
				}
				bookmark = result.Bookmark
			}
			if result.Status == "complete" {
				u, e := url.Parse(result.Result.URL)
				if e != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" || !strings.HasSuffix(strings.ToLower(u.Hostname()), ".cloudflarestorage.com") {
					return state, errors.New("unsupported SQL export download host")
				}
				request, e := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
				if e != nil {
					return state, errors.New("invalid export download")
				}
				// No Cloudflare API authorization header is sent to the presigned URL.
				response, e := c.http.Do(request)
				if e != nil {
					return state, errors.New("SQL export download failed")
				}
				defer response.Body.Close()
				if response.StatusCode != 200 {
					return state, errors.New("SQL export download refused")
				}
				sql, e := io.ReadAll(io.LimitReader(response.Body, (32<<20)+1))
				if e != nil || len(sql) == 0 || len(sql) > 32<<20 {
					return state, errors.New("SQL backup exceeds pilot limit or is unreadable")
				}
				hash := sha256.Sum256(sql)
				backup = SQLBackup{SQL: sql, SHA256: hex.EncodeToString(hash[:]), Bookmark: bookmark}
				return state, nil
			}
			if bookmark == "" {
				return state, errors.New("SQL export did not provide a polling bookmark")
			}
			body["current_bookmark"] = bookmark
			select {
			case <-ctx.Done():
				return state, ctx.Err()
			case <-time.After(time.Second):
			}
		}
		return state, errors.New("SQL export polling timed out")
	})
	return backup, err
}
