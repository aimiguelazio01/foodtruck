package cloudflare

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
)

func TestBootstrapReceiptAllowsResumeAndCleanup(t *testing.T) {
	state, err := NewProvisionState(strings.Repeat("a", 32))
	if err != nil {
		t.Fatal(err)
	}
	state.Workers = map[string]string{"bridge": "bridge-tag", "bootstrap": "setup-tag"}
	directory := t.TempDir()
	if err := writeJournal(filepath.Join(directory, "provision.json"), state); err != nil {
		t.Fatal(err)
	}
	client := New("account-token")
	requests, deletes := 0, 0
	client.http.Transport = transport(func(req *http.Request) (*http.Response, error) {
		body := `{"success":true,"result":{"subdomain":"my-account"}}`
		if strings.HasSuffix(req.URL.Host, ".workers.dev") {
			requests++
			if req.URL.Host != state.Name+"-bridge.my-account.workers.dev" || req.Header.Get("Authorization") != "" || req.Header.Get("x-install-token") != strings.Repeat("b", 64) {
				t.Fatal("credentials sent to incorrect destination")
			}
			if requests == 1 {
				return nil, errors.New("response lost")
			}
			body = fmt.Sprintf(`{"ok":true,"installation":%q}`, state.Name)
		} else if req.Method == http.MethodDelete {
			deletes++
			body = `{"success":true,"result":null}`
		} else if strings.HasSuffix(req.URL.Path, "/script-settings") {
			tag := "setup-tag"
			if strings.Contains(req.URL.Path, "-bridge/") {
				tag = "bridge-tag"
			}
			body = fmt.Sprintf(`{"success":true,"result":{"tags":[%q]}}`, tag)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	run := func() (ProvisionState, error) {
		return client.BootstrapAndCleanupFromJournal(context.Background(), directory, state.Account, strings.Repeat("b", 64), []byte(`{"email":"owner@example.test"}`))
	}
	if _, err := run(); err == nil || deletes != 0 {
		t.Fatal("cleanup ran before a receipt was verified")
	}
	result, err := run()
	if err != nil || !result.BootstrapCompleted || deletes != 2 {
		t.Fatalf("resume failed: %+v %v", result, err)
	}
	if _, err := run(); err != nil || requests != 2 || deletes != 2 {
		t.Fatal("completed bootstrap was repeated")
	}
}
