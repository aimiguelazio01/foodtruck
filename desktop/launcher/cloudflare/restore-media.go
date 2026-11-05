package cloudflare

import (
	"bytes"
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"sort"
	"strings"
	"time"
)

//go:embed restore-media-worker.mjs
var restoreMediaWorker []byte
var restoreImageKey = regexp.MustCompile(`^uploads/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.webp$`)

func (c *Client) RestoreMediaCopy(ctx context.Context, directory, account, id, secret string, files map[string][]byte, state RestoreCopy, save func(RestoreCopy) error) (RestoreCopy, error) {
	if len(id) != 48 || strings.Trim(id, "0123456789abcdef") != "" || len(secret) < 32 {
		return state, errors.New("invalid restore media request")
	}
	total := 0
	for key, data := range files {
		if !restoreImageKey.MatchString(key) || len(data) > 8<<20 {
			return state, errors.New("unsupported restore image")
		}
		total += len(data)
	}
	if total > 32<<20 || len(files) > 1000 {
		return state, errors.New("restore media exceeds pilot limits")
	}
	_, err := withJournal(directory, account, false, func(source ProvisionState, _ func(ProvisionState) error) (ProvisionState, error) {
		tags, exists, e := c.workerTags(ctx, account, source.Name+"-api")
		if e != nil {
			return source, e
		}
		if !exists || !slices.Contains(tags, source.Workers["api"]) || source.Workers["api"] == "" {
			return source, errors.New("source ownership unavailable")
		}
		bucket := "foodtruck-copy-" + id[:32]
		worker := "foodtruck-media-" + id[:32]
		tag := "foodtruck-copy-" + id[:32]
		if state.MediaBucket != "" && state.MediaBucket != bucket || bucket == source.BucketName {
			return source, errors.New("restore bucket must be isolated")
		}
		if state.MediaVerified && state.MediaWorkerDeleted {
			return source, nil
		}
		if state.MediaBucket == "" {
			if state.MediaCreating {
				return source, errors.New("bucket creation outcome unknown; operator recovery required")
			}
			state.MediaCreating = true
			if e = save(state); e != nil {
				return source, e
			}
			created, e := c.CreateBucket(ctx, account, bucket)
			if e != nil {
				return source, e
			}
			state.MediaBucket = created.Name
			state.MediaCreating = false
			if e = save(state); e != nil {
				return source, e
			}
		}
		remoteTags, exists, e := c.workerTags(ctx, account, worker)
		if e != nil {
			return source, e
		}
		if exists && (!state.MediaWorkerIntent || !slices.Contains(remoteTags, tag)) {
			return source, errors.New("restore Worker belongs to another installation")
		}
		if state.MediaCleanup {
			if exists {
				if _, e = c.request(ctx, http.MethodDelete, "/accounts/"+account+"/workers/scripts/"+worker, nil, nil); e != nil {
					return source, e
				}
			}
			state.MediaWorkerDeleted = true
			state.MediaCleanup = false
			return source, save(state)
		}
		if !state.MediaWorkerIntent && exists {
			return source, errors.New("restore Worker already exists")
		}
		state.MediaWorkerIntent = true
		if e = save(state); e != nil {
			return source, e
		}
		metadata, _ := json.Marshal(map[string]any{"main_module": "restore.mjs", "compatibility_date": "2026-11-03", "tags": []string{tag}, "bindings": []map[string]string{{"name": "COPY", "type": "r2_bucket", "bucket_name": bucket}, {"name": "TOKEN", "type": "secret_text", "text": secret}, {"name": "EXPIRES", "type": "plain_text", "text": time.Now().Add(30 * time.Minute).UTC().Format(time.RFC3339)}}})
		if e = c.UploadWorker(ctx, account, worker, metadata, []WorkerModule{{Name: "restore.mjs", Content: restoreMediaWorker}}); e != nil {
			return source, e
		}
		if _, e = c.request(ctx, http.MethodPost, "/accounts/"+account+"/workers/scripts/"+worker+"/subdomain", map[string]bool{"enabled": true, "previews_enabled": false}, nil); e != nil {
			return source, e
		}
		var domain struct {
			Subdomain string `json:"subdomain"`
		}
		if _, e = c.request(ctx, http.MethodGet, "/accounts/"+account+"/workers/subdomain", nil, &domain); e != nil {
			return source, e
		}
		if !subdomainPattern.MatchString(domain.Subdomain) {
			return source, errors.New("invalid restore address")
		}
		keys := make([]string, 0, len(files))
		for key := range files {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			data := files[key]
			sum := sha256.Sum256(data)
			expected := hex.EncodeToString(sum[:])
			address := "https://" + worker + "." + domain.Subdomain + ".workers.dev/?key=" + url.QueryEscape(key)
			for _, method := range []string{http.MethodPut, http.MethodGet} {
				var body io.Reader
				if method == http.MethodPut {
					body = bytes.NewReader(data)
				}
				request, e := http.NewRequestWithContext(ctx, method, address, body)
				if e != nil {
					return source, e
				}
				request.Header.Set("x-foodtruck-restore", secret)
				request.Header.Set("x-content-sha256", expected)
				response, e := c.http.Do(request)
				if e != nil {
					return source, errors.New("image restore response lost; resume validation")
				}
				var receipt struct {
					SHA256 string `json:"sha256"`
				}
				e = json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&receipt)
				response.Body.Close()
				if e != nil || response.StatusCode != 200 || receipt.SHA256 != expected {
					return source, errors.New("image restore checksum could not be verified")
				}
			}
		}
		state.MediaVerified = true
		state.MediaCleanup = true
		if e = save(state); e != nil {
			return source, e
		}
		tags, exists, e = c.workerTags(ctx, account, worker)
		if e != nil {
			return source, e
		}
		if !exists || !slices.Contains(tags, tag) {
			return source, errors.New("restore Worker cleanup ownership unavailable")
		}
		if _, e = c.request(ctx, http.MethodDelete, "/accounts/"+account+"/workers/scripts/"+worker, nil, nil); e != nil {
			return source, e
		}
		state.MediaWorkerDeleted = true
		state.MediaCleanup = false
		return source, save(state)
	})
	return state, err
}
