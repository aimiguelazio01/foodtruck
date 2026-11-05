package cloudflare

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
)

func TestMediaExportUsesOnlyInstallationCredential(t *testing.T) {
	state, _ := NewProvisionState(strings.Repeat("a", 32))
	state.Workers = map[string]string{"management": "owned"}
	dir := t.TempDir()
	if e := writeJournal(filepath.Join(dir, "provision.json"), state); e != nil {
		t.Fatal(e)
	}
	client := New("api-secret")
	credential := strings.Repeat("b", 48)
	key := "uploads/12345678-1234-1234-1234-123456789abc.webp"
	client.http.Transport = transport(func(r *http.Request) (*http.Response, error) {
		body := `{"success":true,"result":{"tags":["owned"]}}`
		headers := http.Header{}
		if strings.HasSuffix(r.URL.Host, ".workers.dev") {
			if r.Header.Get("Authorization") != "" || r.Header.Get("x-foodtruck-backup") != credential {
				t.Fatal("credential boundary violated")
			}
			if r.URL.Query().Get("key") == "" {
				body = `{"objects":[{"key":"` + key + `","size":3,"etag":"v1"}],"cursor":null}`
			} else {
				body = "abc"
				headers.Set("X-Backup-Etag", "v1")
			}
		} else if strings.HasSuffix(r.URL.Path, "/workers/subdomain") {
			body = `{"success":true,"result":{"subdomain":"account"}}`
		}
		return &http.Response{StatusCode: 200, Header: headers, Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	files, e := client.ExportMediaFromJournal(context.Background(), dir, state.Account, credential)
	if e != nil || !bytes.Equal(files[key], []byte("abc")) {
		t.Fatal("media export failed", e)
	}
}
