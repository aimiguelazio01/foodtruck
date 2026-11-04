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

func TestWorkerAddressChecksBootstrapAndReconcilesExposure(t *testing.T) {
	state, err := NewProvisionState(strings.Repeat("a", 32))
	if err != nil {
		t.Fatal(err)
	}
	state.Workers = map[string]string{"api": "api-tag", "customer": "customer-tag"}
	directory := t.TempDir()
	journal := filepath.Join(directory, "provision.json")
	if err := writeJournal(journal, state); err != nil {
		t.Fatal(err)
	}
	client := New("test-token")
	remote := subdomainSettings{Previews: true}
	changes := 0
	client.http.Transport = transport(func(req *http.Request) (*http.Response, error) {
		body := `{"success":true,"result":{"subdomain":"my-account"}}`
		if strings.HasSuffix(req.URL.Path, "/script-settings") {
			body = `{"success":true,"result":{"tags":["customer-tag"]}}`
		} else if strings.Contains(req.URL.Path, "/scripts/") {
			if req.Method == http.MethodPost {
				if err := json.NewDecoder(req.Body).Decode(&remote); err != nil {
					t.Fatal(err)
				}
				changes++
			}
			encoded, _ := json.Marshal(remote)
			body = fmt.Sprintf(`{"success":true,"result":%s}`, encoded)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	ctx := context.Background()
	if _, err := client.ConfigureWorkerAddressFromJournal(ctx, directory, state.Account, "customer", true); err == nil {
		t.Fatal("customer site enabled before bootstrap")
	}
	if _, err := client.ConfigureWorkerAddressFromJournal(ctx, directory, state.Account, "api", true); err == nil {
		t.Fatal("private API was enabled")
	}
	state.BootstrapCompleted = true
	if err := writeJournal(journal, state); err != nil {
		t.Fatal(err)
	}
	address, err := client.ConfigureWorkerAddressFromJournal(ctx, directory, state.Account, "customer", true)
	if err != nil || !address.Enabled || remote.Previews || changes != 1 || address.URL != "https://"+state.Name+"-customer.my-account.workers.dev" {
		t.Fatalf("unexpected address result: %+v %v changes=%d", address, err, changes)
	}
	if _, err := client.ConfigureWorkerAddressFromJournal(ctx, directory, state.Account, "customer", true); err != nil || changes != 1 {
		t.Fatal("confirmed exposure was unnecessarily changed")
	}
}
