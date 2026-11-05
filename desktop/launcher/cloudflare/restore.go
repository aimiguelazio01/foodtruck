package cloudflare

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
)

type RestoreCopy struct {
	PackageVersion     string `json:"packageVersion,omitempty"`
	SchemaVerified     bool   `json:"schemaVerified,omitempty"`
	MediaBucket        string `json:"mediaBucket,omitempty"`
	MediaCreating      bool   `json:"mediaCreating,omitempty"`
	MediaWorkerIntent  bool   `json:"mediaWorkerIntent,omitempty"`
	MediaVerified      bool   `json:"mediaVerified,omitempty"`
	MediaCleanup       bool   `json:"mediaCleanup,omitempty"`
	MediaWorkerDeleted bool   `json:"mediaWorkerDeleted,omitempty"`
	DatabaseID         string `json:"databaseId,omitempty"`
	Creating           bool   `json:"creating,omitempty"`
	Ingesting          bool   `json:"ingesting,omitempty"`
	Bookmark           string `json:"bookmark,omitempty"`
	Imported           bool   `json:"imported,omitempty"`
	Verified           bool   `json:"verified,omitempty"`
}

// ValidateBackupCopy never changes the source database or any Worker binding.
// Ambiguous mutations stop for recovery instead of repeating DDL/import blindly.
func (c *Client) ValidateBackupCopy(ctx context.Context, directory, account, id string, sql []byte, checksum string, state RestoreCopy, save func(RestoreCopy) error) (RestoreCopy, error) {
	return c.validateBackupCopy(ctx, directory, account, id, sql, checksum, state, save, nil)
}
func (c *Client) validateBackupCopy(ctx context.Context, directory, account, id string, sql []byte, checksum string, state RestoreCopy, save func(RestoreCopy) error, schema *DatabaseSchema) (RestoreCopy, error) {
	hash := sha256.Sum256(sql)
	if hex.EncodeToString(hash[:]) != checksum || len(sql) == 0 || len(sql) > 32<<20 || len(id) != 48 || strings.Trim(id, "0123456789abcdef") != "" {
		return state, errors.New("invalid backup copy input")
	}
	_, err := withJournal(directory, account, false, func(source ProvisionState, _ func(ProvisionState) error) (ProvisionState, error) {
		tags, exists, e := c.workerTags(ctx, account, source.Name+"-api")
		if e != nil {
			return source, e
		}
		if !exists || source.Workers["api"] == "" || !slices.Contains(tags, source.Workers["api"]) {
			return source, errors.New("source ownership not verified")
		}
		if state.DatabaseID == source.DatabaseID && state.DatabaseID != "" {
			return source, errors.New("restore target must be isolated")
		}
		if state.DatabaseID == "" {
			if state.Creating {
				return source, errors.New("target creation outcome unknown; operator recovery required")
			}
			state.Creating = true
			if e = save(state); e != nil {
				return source, e
			}
			db, e := c.CreateDatabase(ctx, account, "foodtruck-restore-"+id[:32])
			if e != nil {
				return source, e
			}
			state.DatabaseID = db.ID
			state.Creating = false
			if e = save(state); e != nil {
				return source, e
			}
		}
		path := "/accounts/" + account + "/d1/database/" + state.DatabaseID + "/import"
		type result struct {
			Status   string `json:"status"`
			Filename string `json:"filename"`
			URL      string `json:"upload_url"`
			Bookmark string `json:"at_bookmark"`
		}
		if !state.Imported && state.Bookmark == "" {
			if state.Ingesting {
				return source, errors.New("import outcome unknown; operator recovery required")
			}
			md := md5.Sum(sql)
			etag := hex.EncodeToString(md[:])
			var init result
			if _, e = c.request(ctx, http.MethodPost, path, map[string]string{"action": "init", "etag": etag}, &init); e != nil {
				return source, e
			}
			if init.Filename == "" {
				return source, errors.New("import filename missing")
			}
			if init.URL != "" {
				u, e := url.Parse(init.URL)
				if e != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" || !strings.HasSuffix(strings.ToLower(u.Hostname()), ".cloudflarestorage.com") {
					return source, errors.New("untrusted import upload host")
				}
				request, e := http.NewRequestWithContext(ctx, http.MethodPut, u.String(), bytes.NewReader(sql))
				if e != nil {
					return source, e
				}
				response, e := c.http.Do(request)
				if e != nil {
					return source, errors.New("SQL upload failed")
				}
				response.Body.Close()
				if response.StatusCode < 200 || response.StatusCode >= 300 {
					return source, errors.New("SQL upload refused")
				}
			}
			state.Ingesting = true
			if e = save(state); e != nil {
				return source, e
			}
			var ingest result
			if _, e = c.request(ctx, http.MethodPost, path, map[string]string{"action": "ingest", "etag": etag, "filename": init.Filename}, &ingest); e != nil {
				return source, e
			}
			if ingest.Status == "error" {
				return source, errors.New("SQL import failed")
			}
			state.Bookmark = ingest.Bookmark
			state.Imported = ingest.Status == "complete"
			if e = save(state); e != nil {
				return source, e
			}
		}
		for i := 0; !state.Imported && i < 120; i++ {
			if state.Bookmark == "" {
				return source, errors.New("import bookmark missing")
			}
			var poll result
			if _, e = c.request(ctx, http.MethodPost, path, map[string]string{"action": "poll", "current_bookmark": state.Bookmark}, &poll); e != nil {
				return source, e
			}
			if poll.Status == "error" {
				return source, errors.New("SQL import failed")
			}
			if poll.Status == "complete" {
				state.Imported = true
				if e = save(state); e != nil {
					return source, e
				}
				break
			}
			select {
			case <-ctx.Done():
				return source, ctx.Err()
			case <-time.After(time.Second):
			}
		}
		if !state.Imported {
			return source, errors.New("import polling timed out")
		}
		var queries []struct {
			Success bool                         `json:"success"`
			Results []map[string]json.RawMessage `json:"results"`
		}
		if _, e = c.request(ctx, http.MethodPost, "/accounts/"+account+"/d1/database/"+state.DatabaseID+"/query", map[string]any{"sql": "PRAGMA quick_check; PRAGMA foreign_key_check; SELECT bootstrap_id FROM installation_state WHERE id=1;", "params": []any{}}, &queries); e != nil {
			return source, e
		}
		if len(queries) != 3 || !queries[0].Success || !queries[1].Success || !queries[2].Success || len(queries[0].Results) != 1 || len(queries[1].Results) != 0 || len(queries[2].Results) != 1 {
			return source, errors.New("restored database validation failed")
		}
		var check, receipt string
		_ = json.Unmarshal(queries[0].Results[0]["quick_check"], &check)
		_ = json.Unmarshal(queries[2].Results[0]["bootstrap_id"], &receipt)
		if check != "ok" || receipt != source.Name {
			return source, errors.New("restored database identity mismatch")
		}
		if schema != nil {
			if e = c.verifyRestoredSchema(ctx, account, state.DatabaseID, *schema); e != nil {
				return source, e
			}
			if e = c.clearRestoredSessions(ctx, account, state.DatabaseID); e != nil {
				return source, e
			}
			state.SchemaVerified = true
		}
		state.Verified = true
		return source, save(state)
	})
	return state, err
}
