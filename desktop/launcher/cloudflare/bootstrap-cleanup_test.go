package cloudflare

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestBootstrapCleanupReconcilesLostDeleteResponse(t *testing.T) {
	state, err := NewProvisionState(strings.Repeat("a", 32))
	if err != nil {
		t.Fatal(err)
	}
	state.Workers = map[string]string{"bridge": "bridge-tag", "bootstrap": "setup-tag"}
	journal := state
	save := func(next ProvisionState) error { journal = next; return nil }
	client := New("test-token")
	deleted := map[string]bool{}
	deletes := 0
	client.http.Transport = transport(func(req *http.Request) (*http.Response, error) {
		role := "bootstrap"
		if strings.Contains(req.URL.Path, "-bridge") {
			role = "bridge"
		}
		status := 200
		body := fmt.Sprintf(`{"success":true,"result":{"tags":[%q]}}`, state.Workers[role])
		if req.Method == http.MethodDelete {
			if journal.CleanupPending != role {
				t.Fatal("deletion intent was not recorded")
			}
			deletes++
			deleted[role] = true
			if role == "bridge" {
				return nil, errors.New("delete response lost")
			}
		} else if deleted[role] {
			status, body = 404, `{"success":false}`
		}
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	if _, err := client.cleanupBootstrap(context.Background(), journal, save); err == nil || deletes != 0 {
		t.Fatal("cleanup ran before successful bootstrap")
	}
	journal.BootstrapCompleted = true
	if _, err := client.cleanupBootstrap(context.Background(), journal, save); err == nil || journal.CleanupPending != "bridge" {
		t.Fatal("lost delete outcome was not recorded")
	}
	result, err := client.cleanupBootstrap(context.Background(), journal, save)
	if err != nil || !result.TemporaryDeleted["bridge"] || !result.TemporaryDeleted["bootstrap"] || deletes != 2 {
		t.Fatalf("cleanup resume failed: %+v %v, deletes %d", result, err, deletes)
	}
	if _, err := client.cleanupBootstrap(context.Background(), result, save); err != nil || deletes != 2 {
		t.Fatal("completed cleanup was repeated")
	}
}

func TestBootstrapCleanupRefusesForeignWorker(t *testing.T) {
	state, _ := NewProvisionState(strings.Repeat("a", 32))
	state.BootstrapCompleted = true
	state.Workers = map[string]string{"bridge": "expected"}
	client := New("test-token")
	client.http.Transport = transport(func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodGet {
			t.Fatal("foreign Worker was changed")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"success":true,"result":{"tags":["foreign"]}}`))}, nil
	})
	if _, err := client.cleanupBootstrap(context.Background(), state, func(ProvisionState) error { t.Fatal("foreign resource recorded for deletion"); return nil }); err == nil {
		t.Fatal("foreign Worker ownership was accepted")
	}
}
