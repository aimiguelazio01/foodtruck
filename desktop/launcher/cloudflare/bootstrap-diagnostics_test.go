package cloudflare

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
)

func TestBootstrapDiagnosticsDoesNotReturnSecretValues(t *testing.T) {
	state, err := NewProvisionState(strings.Repeat("a", 32))
	if err != nil {
		t.Fatal(err)
	}
	state.DatabaseID = "database"
	state.Workers = map[string]string{"bootstrap": "setup-tag", "bridge": "bridge-tag"}
	dir := t.TempDir()
	if err := writeJournal(filepath.Join(dir, "provision.json"), state); err != nil {
		t.Fatal(err)
	}
	client := New("test-token")
	queries := 0
	client.http.Transport = transport(func(req *http.Request) (*http.Response, error) {
		body := `{"success":true,"result":{"bindings":[{"name":"INSTALL_TOKEN","text":"private-secret"}]}}`
		if strings.HasSuffix(req.URL.Path, "/script-settings") {
			tag := "setup-tag"
			if strings.Contains(req.URL.Path, "-bridge/") {
				tag = "bridge-tag"
			}
			body = fmt.Sprintf(`{"success":true,"result":{"tags":[%q]}}`, tag)
		} else if strings.HasSuffix(req.URL.Path, "/query") {
			values := []int{1, 16, 1, 0}
			if queries >= len(values) {
				t.Fatal("unexpected diagnostic query")
			}
			body = fmt.Sprintf(`{"success":true,"result":[{"success":true,"results":[{"n":%d}]}]}`, values[queries])
			queries++
		} else if req.Method != http.MethodGet {
			t.Fatal("diagnostics changed a resource")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	diagnostic, err := client.DiagnoseBootstrap(context.Background(), dir, state.Account)
	if err != nil || !diagnostic.DatabaseResponds || diagnostic.MigrationsApplied != 16 || diagnostic.InstallationReady {
		t.Fatalf("unexpected diagnostics: %+v %v", diagnostic, err)
	}
	encoded, _ := json.Marshal(diagnostic)
	if strings.Contains(string(encoded), "private-secret") {
		t.Fatal("secret included in diagnostics")
	}
}
