package cloudflare

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
)

func TestSQLBackupOwnershipAndCredentialBoundary(t *testing.T) {
	state, _ := NewProvisionState(strings.Repeat("a", 32))
	state.DatabaseID = "database"
	state.BootstrapCompleted = true
	state.Workers = map[string]string{"api": "owned-tag"}
	dir := t.TempDir()
	if e := writeJournal(filepath.Join(dir, "provision.json"), state); e != nil {
		t.Fatal(e)
	}
	client := New("private-api-token")
	foreign := false
	badHost := false
	downloads := 0
	client.http.Transport = transport(func(r *http.Request) (*http.Response, error) {
		body := ""
		if r.URL.Host == "backup.r2.cloudflarestorage.com" {
			downloads++
			if r.Header.Get("Authorization") != "" {
				t.Fatal("API token leaked to signed download")
			}
			body = "CREATE TABLE example(id text);"
		} else {
			if r.Header.Get("Authorization") != "Bearer private-api-token" {
				t.Fatal("missing API authorization")
			}
			if strings.HasSuffix(r.URL.Path, "script-settings") {
				tag := "owned-tag"
				if foreign {
					tag = "other"
				}
				body = fmt.Sprintf(`{"success":true,"result":{"tags":[%q]}}`, tag)
			} else {
				host := "backup.r2.cloudflarestorage.com"
				if badHost {
					host = "attacker.example"
				}
				body = fmt.Sprintf(`{"success":true,"result":{"status":"complete","at_bookmark":"snapshot-1","result":{"signed_url":"https://%s/export.sql?signature=secret"}}}`, host)
			}
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	backup, e := client.ExportSQLFromJournal(context.Background(), dir, state.Account)
	if e != nil {
		t.Fatal(e)
	}
	hash := sha256.Sum256(backup.SQL)
	if backup.SHA256 != hex.EncodeToString(hash[:]) || backup.Bookmark != "snapshot-1" || downloads != 1 {
		t.Fatal("backup integrity missing")
	}
	badHost = true
	if _, e = client.ExportSQLFromJournal(context.Background(), dir, state.Account); e == nil || downloads != 1 {
		t.Fatal("untrusted download accepted")
	}
	foreign = true
	if _, e = client.ExportSQLFromJournal(context.Background(), dir, state.Account); e == nil {
		t.Fatal("foreign Worker accepted")
	}
}
