package cloudflare

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
)

func TestIsolatedRestoreAndResume(t *testing.T) {
	source, _ := NewProvisionState(strings.Repeat("a", 32))
	source.DatabaseID = "production-db"
	source.Workers = map[string]string{"api": "owned"}
	dir := t.TempDir()
	if e := writeJournal(filepath.Join(dir, "provision.json"), source); e != nil {
		t.Fatal(e)
	}
	sql := []byte("CREATE TABLE example(id TEXT);")
	hash := sha256.Sum256(sql)
	checksum := hex.EncodeToString(hash[:])
	client := New("api-secret")
	creates, imports := 0, 0
	lost := false
	client.http.Transport = transport(func(r *http.Request) (*http.Response, error) {
		body := `{"success":true,"result":{}}`
		if strings.Contains(r.URL.Path, "production-db") {
			t.Fatal("production database touched")
		}
		if r.URL.Host == "upload.r2.cloudflarestorage.com" {
			if r.Header.Get("Authorization") != "" {
				t.Fatal("API credential leaked")
			}
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(""))}, nil
		}
		switch {
		case strings.HasSuffix(r.URL.Path, "script-settings"):
			body = `{"success":true,"result":{"tags":["owned"]}}`
		case strings.HasSuffix(r.URL.Path, "/d1/database"):
			creates++
			var input map[string]string
			json.NewDecoder(r.Body).Decode(&input)
			body = fmt.Sprintf(`{"success":true,"result":{"uuid":"copy-db","name":%q}}`, input["name"])
		case strings.HasSuffix(r.URL.Path, "/import"):
			var input map[string]string
			json.NewDecoder(r.Body).Decode(&input)
			if input["action"] == "init" {
				body = `{"success":true,"result":{"filename":"copy.sql","upload_url":"https://upload.r2.cloudflarestorage.com/sql?signature=secret"}}`
			} else {
				imports++
				if lost {
					return nil, errors.New("lost ingest response")
				}
				body = `{"success":true,"result":{"status":"complete","at_bookmark":"copy-bookmark"}}`
			}
		case strings.HasSuffix(r.URL.Path, "/query"):
			body = fmt.Sprintf(`{"success":true,"result":[{"success":true,"results":[{"quick_check":"ok"}]},{"success":true,"results":[]},{"success":true,"results":[{"bootstrap_id":%q}]}]}`, source.Name)
		default:
			t.Fatal("unexpected request")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	state := RestoreCopy{}
	save := func(next RestoreCopy) error { state = next; return nil }
	call := func() error {
		_, e := client.ValidateBackupCopy(context.Background(), dir, source.Account, strings.Repeat("c", 48), sql, checksum, state, save)
		return e
	}
	if e := call(); e != nil || !state.Verified || state.DatabaseID != "copy-db" {
		t.Fatal("copy validation failed", e)
	}
	if e := call(); e != nil || creates != 1 || imports != 1 {
		t.Fatal("verified copy was reimported", e)
	}
	state = RestoreCopy{DatabaseID: "another-copy"}
	lost = true
	if e := call(); e == nil || !state.Ingesting {
		t.Fatal("uncertain import not persisted")
	}
	before := imports
	if e := call(); e == nil || imports != before {
		t.Fatal("uncertain import repeated")
	}
	state = RestoreCopy{DatabaseID: source.DatabaseID}
	if e := call(); e == nil {
		t.Fatal("source accepted as target")
	}
}
