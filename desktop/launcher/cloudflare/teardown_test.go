package cloudflare

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func ensureAndWrite(directory, journal string, state ProvisionState) error {
	if err := os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	return writeJournal(journal, state)
}

type fakeAccount struct {
	workers      map[string][]string // script -> tags
	domains      map[string]string   // hostname -> service
	databaseName string
	database     bool
	bucket       bool
	bucketBusy   bool
	lifecycle    int
	deleted      []string
}

func (f *fakeAccount) handler(t *testing.T, accountID string) transport {
	return func(req *http.Request) (*http.Response, error) {
		reply := func(status int, result any) (*http.Response, error) {
			encoded, _ := json.Marshal(map[string]any{"success": status < 300, "result": result})
			return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(string(encoded)))}, nil
		}
		path := strings.TrimPrefix(req.URL.Path, "/client/v4/accounts/"+accountID)
		switch {
		case strings.HasSuffix(path, "/script-settings"):
			name := strings.TrimSuffix(strings.TrimPrefix(path, "/workers/scripts/"), "/script-settings")
			tags, ok := f.workers[name]
			if !ok {
				return reply(404, nil)
			}
			return reply(200, map[string]any{"tags": tags})
		case strings.HasPrefix(path, "/workers/scripts/") && req.Method == http.MethodDelete:
			name := strings.TrimPrefix(path, "/workers/scripts/")
			delete(f.workers, name)
			f.deleted = append(f.deleted, "worker:"+name)
			return reply(200, nil)
		case path == "/workers/domains" && req.Method == http.MethodGet:
			host := req.URL.Query().Get("hostname")
			if service, ok := f.domains[host]; ok {
				return reply(200, []workerDomain{{ID: "id-" + host, Hostname: host, Service: service}})
			}
			return reply(200, []workerDomain{})
		case strings.HasPrefix(path, "/workers/domains/") && req.Method == http.MethodDelete:
			host := strings.TrimPrefix(strings.TrimPrefix(path, "/workers/domains/"), "id-")
			delete(f.domains, host)
			f.deleted = append(f.deleted, "domain:"+host)
			return reply(200, nil)
		case strings.HasPrefix(path, "/d1/database/") && req.Method == http.MethodGet:
			if !f.database {
				return reply(404, nil)
			}
			return reply(200, map[string]string{"name": f.databaseName})
		case strings.HasPrefix(path, "/d1/database/") && req.Method == http.MethodDelete:
			f.database = false
			f.deleted = append(f.deleted, "database")
			return reply(200, nil)
		case strings.HasSuffix(path, "/lifecycle") && req.Method == http.MethodPut:
			f.lifecycle++
			return reply(200, nil)
		case strings.HasPrefix(path, "/r2/buckets/") && req.Method == http.MethodDelete:
			if !f.bucket {
				return reply(404, nil)
			}
			if f.bucketBusy {
				return reply(409, nil)
			}
			f.bucket = false
			f.deleted = append(f.deleted, "bucket")
			return reply(200, nil)
		}
		t.Fatalf("unexpected request %s %s", req.Method, req.URL)
		return nil, nil
	}
}

func TestTeardownRemovesOnlyThisInstallationAndResumes(t *testing.T) {
	account := strings.Repeat("a", 32)
	state, err := NewProvisionState(account)
	if err != nil {
		t.Fatal(err)
	}
	state.DatabaseID = "00000000-0000-0000-0000-000000000001"
	state.BucketName = state.Name
	state.BootstrapCompleted = true
	state.TemporaryDeleted = map[string]bool{"bridge": true, "bootstrap": true}
	state.Workers = map[string]string{"api": "t-api", "customer": "t-customer", "management": "t-management", "bridge": "t-bridge", "bootstrap": "t-bootstrap"}
	state.Domains = []string{"bella.example.pt", "bella-gestao.example.pt"}
	root := t.TempDir()
	digest := sha256.Sum256([]byte(account + "\npurchase-1"))
	directory := filepath.Join(root, hex.EncodeToString(digest[:]))
	if err := ensureAndWrite(directory, filepath.Join(directory, "provision.json"), state); err != nil {
		t.Fatal(err)
	}

	fake := &fakeAccount{
		workers:      map[string][]string{state.Name + "-api": {"t-api"}, state.Name + "-customer": {"t-customer"}, state.Name + "-management": {"t-management"}},
		domains:      map[string]string{"bella.example.pt": state.Name + "-customer", "bella-gestao.example.pt": state.Name + "-management"},
		databaseName: state.Name, database: true, bucket: true, bucketBusy: true,
	}
	client := New("test-token")
	client.http.Transport = fake.handler(t, account)
	ctx := context.Background()

	// The bucket still holds objects: everything else goes, and the call reports it must be repeated.
	got, err := client.TeardownPilot(ctx, root, account, "purchase-1")
	if !errors.Is(err, ErrStoragePending) {
		t.Fatalf("expected a pending bucket, got %v", err)
	}
	if got.Teardown != tearDownDatabase || fake.lifecycle != 1 {
		t.Fatalf("progress was not journaled: %+v lifecycle=%d", got, fake.lifecycle)
	}
	want := []string{"domain:bella.example.pt", "domain:bella-gestao.example.pt", "worker:" + state.Name + "-customer", "worker:" + state.Name + "-management", "worker:" + state.Name + "-api", "database"}
	if strings.Join(fake.deleted, ",") != strings.Join(want, ",") {
		t.Fatalf("wrong deletion order:\n got %v\nwant %v", fake.deleted, want)
	}
	// Later the bucket is empty: the same call finishes without touching anything twice.
	fake.bucketBusy = false
	got, err = client.TeardownPilot(ctx, root, account, "purchase-1")
	if err != nil || got.Teardown != tearDownComplete || fake.bucket || len(fake.deleted) != len(want)+1 {
		t.Fatalf("resume failed: %v %+v %v", err, got, fake.deleted)
	}
	if again, err := client.TeardownPilot(ctx, root, account, "purchase-1"); err != nil || again.Teardown != tearDownComplete || len(fake.deleted) != len(want)+1 {
		t.Fatalf("completed teardown must be a no-op: %v", err)
	}
}

func TestTeardownRefusesResourcesThatChangedOwner(t *testing.T) {
	account := strings.Repeat("b", 32)
	for name, mutate := range map[string]func(*fakeAccount, ProvisionState){
		"worker with a foreign tag": func(f *fakeAccount, s ProvisionState) { f.workers[s.Name+"-api"] = []string{"someone-else"} },
		"address bound elsewhere":   func(f *fakeAccount, s ProvisionState) { f.domains["bella.example.pt"] = "foodtruck-other-customer" },
		"database renamed":          func(f *fakeAccount, s ProvisionState) { f.databaseName = "another-database" },
	} {
		t.Run(name, func(t *testing.T) {
			state, _ := NewProvisionState(account)
			state.DatabaseID = "00000000-0000-0000-0000-000000000002"
			state.BucketName = state.Name
			state.BootstrapCompleted = true
			state.TemporaryDeleted = map[string]bool{"bridge": true, "bootstrap": true}
			state.Workers = map[string]string{"api": "t-api", "customer": "t-customer", "management": "t-management"}
			state.Domains = []string{"bella.example.pt"}
			root := t.TempDir()
			digest := sha256.Sum256([]byte(account + "\np"))
			directory := filepath.Join(root, hex.EncodeToString(digest[:]))
			if err := ensureAndWrite(directory, filepath.Join(directory, "provision.json"), state); err != nil {
				t.Fatal(err)
			}
			fake := &fakeAccount{
				workers: map[string][]string{state.Name + "-api": {"t-api"}, state.Name + "-customer": {"t-customer"}, state.Name + "-management": {"t-management"}},
				domains: map[string]string{"bella.example.pt": state.Name + "-customer"}, databaseName: state.Name, database: true, bucket: true,
			}
			mutate(fake, state)
			client := New("test-token")
			client.http.Transport = fake.handler(t, account)
			if _, err := client.TeardownPilot(context.Background(), root, account, "p"); err == nil {
				t.Fatal("teardown went ahead")
			}
			if !fake.bucket {
				t.Fatal("the bucket was removed despite an earlier refusal")
			}
			if name == "database renamed" && !fake.database {
				t.Fatal("a database that is not ours was deleted")
			}
		})
	}
}
