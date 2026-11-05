package cloudflare

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
)

func TestMediaRestoreCleanupLostResponse(t *testing.T) {
	source, _ := NewProvisionState(strings.Repeat("a", 32))
	source.BucketName = "production-bucket"
	source.Workers = map[string]string{"api": "source-tag"}
	dir := t.TempDir()
	if e := writeJournal(filepath.Join(dir, "provision.json"), source); e != nil {
		t.Fatal(e)
	}
	id := strings.Repeat("c", 48)
	tag := "foodtruck-copy-" + id[:32]
	exists := false
	creates, uploads := 0, 0
	deleted := false
	client := New("api-token")
	data := []byte("image")
	sum := sha256.Sum256(data)
	checksum := fmt.Sprintf("%x", sum)
	client.http.Transport = transport(func(r *http.Request) (*http.Response, error) {
		body := `{"success":true,"result":{}}`
		status := 200
		if strings.Contains(r.URL.String(), source.BucketName) {
			t.Fatal("production bucket touched")
		}
		if strings.HasSuffix(r.URL.Host, ".workers.dev") {
			if r.Header.Get("Authorization") != "" || r.Header.Get("x-foodtruck-restore") == "" {
				t.Fatal("credential boundary violated")
			}
			body = `{"sha256":"` + checksum + `"}`
		} else if strings.HasSuffix(r.URL.Path, source.Name+"-api/script-settings") {
			body = `{"success":true,"result":{"tags":["source-tag"]}}`
		} else if strings.HasSuffix(r.URL.Path, "/script-settings") {
			if exists {
				body = `{"success":true,"result":{"tags":["` + tag + `"]}}`
			} else {
				status = 404
				body = `{"success":false}`
			}
		} else if strings.HasSuffix(r.URL.Path, "/r2/buckets") {
			creates++
			var input map[string]string
			json.NewDecoder(r.Body).Decode(&input)
			body = `{"success":true,"result":{"name":"` + input["name"] + `"}}`
		} else if r.Method == "PUT" {
			uploads++
			exists = true
		} else if r.Method == "DELETE" {
			exists = false
			if !deleted {
				deleted = true
				status = 500
				body = `{"success":false}`
			}
		} else if strings.HasSuffix(r.URL.Path, "/workers/subdomain") {
			body = `{"success":true,"result":{"subdomain":"test-account"}}`
		}
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	state := RestoreCopy{}
	save := func(next RestoreCopy) error { state = next; return nil }
	call := func() error {
		_, e := client.RestoreMediaCopy(context.Background(), dir, source.Account, id, strings.Repeat("b", 64), map[string][]byte{"uploads/12345678-1234-1234-1234-123456789abc.webp": data}, state, save)
		return e
	}
	if e := call(); e == nil || !state.MediaCleanup || !state.MediaVerified {
		t.Fatal("cleanup response loss not persisted")
	}
	if e := call(); e != nil || !state.MediaWorkerDeleted || creates != 1 || uploads != 1 {
		t.Fatal("cleanup recovery duplicated resources", e)
	}
}
