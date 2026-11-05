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

func TestPublishNewWorkerRecoversLostResponse(t *testing.T) {
	state, err := NewProvisionState(strings.Repeat("a", 32))
	if err != nil {
		t.Fatal(err)
	}
	state.DatabaseID, state.BucketName = "database", state.Name
	journal := state
	client := New("test-token")
	var remoteTag string
	writes := 0
	client.http.Transport = transport(func(req *http.Request) (*http.Response, error) {
		if req.Method == http.MethodPut {
			writes++
			if journal.WorkerPending == nil {
				t.Fatal("upload intent was not saved first")
			}
			remoteTag = journal.WorkerPending.Tag
			return nil, errors.New("response lost")
		}
		if remoteTag == "" {
			return &http.Response{StatusCode: 404, Body: io.NopCloser(strings.NewReader(`{"success":false}`))}, nil
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(fmt.Sprintf(`{"success":true,"result":{"tags":[%q]}}`, remoteTag)))}, nil
	})
	call := func() error {
		_, err := client.PublishNewWorker(context.Background(), journal, "api", []byte(`{"main_module":"api.mjs"}`),
			[]WorkerModule{{Name: "api.mjs", Content: []byte("export default {}")}}, nil,
			func(next ProvisionState) error { journal = next; return nil })
		return err
	}
	if err := call(); err == nil || journal.WorkerPending == nil {
		t.Fatal("lost response was not recorded")
	}
	if err := call(); err != nil || journal.WorkerPending != nil || journal.Workers["api"] != remoteTag || writes != 1 {
		t.Fatalf("resume did not reconcile existing Worker: %v", err)
	}
	changed := []WorkerModule{{Name: "api.mjs", Content: []byte("export default {changed:true}")}}
	if _, err := client.PublishNewWorker(context.Background(), journal, "api", []byte(`{"main_module":"api.mjs"}`), changed, nil,
		func(ProvisionState) error { t.Fatal("changed package was saved"); return nil }); err == nil {
		t.Fatal("changed package was treated as an already completed deployment")
	}
	dir := t.TempDir()
	if err := writeJournal(filepath.Join(dir, "provision.json"), journal); err != nil {
		t.Fatal(err)
	}
	if _, err := client.PublishWorkerFromJournal(context.Background(), dir, journal.Account, "api", []byte(`{"main_module":"api.mjs"}`),
		[]WorkerModule{{Name: "api.mjs", Content: []byte("export default {}")}}, nil); err != nil {
		t.Fatalf("disk journal could not resume the completed upload: %v", err)
	}
	remoteTag = "other-installation"
	if err := call(); err == nil || writes != 1 {
		t.Fatal("foreign Worker was accepted")
	}
}

func TestTemporaryWorkerRepairPreservesOwnershipAndRetries(t *testing.T) {
	state, _ := NewProvisionState(strings.Repeat("a", 32))
	state.DatabaseID, state.BucketName = "database", state.Name
	state.Workers = map[string]string{"bootstrap": "owned-tag"}
	state.WorkerDigests = map[string]string{"bootstrap": "old-digest"}
	client := New("token")
	writes := 0
	foreign := false
	client.http.Transport = transport(func(req *http.Request) (*http.Response, error) {
		if req.Method == http.MethodPut {
			writes++
			if state.WorkerPending == nil {
				t.Fatal("missing update intent")
			}
			if writes == 1 {
				return nil, errors.New("lost response")
			}
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"success":true,"result":{}}`))}, nil
		}
		tag := "owned-tag"
		if foreign {
			tag = "foreign"
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(fmt.Sprintf(`{"success":true,"result":{"tags":[%q]}}`, tag)))}, nil
	})
	call := func() error {
		_, err := client.PublishNewWorker(context.Background(), state, "bootstrap", []byte(`{"main_module":"setup.mjs"}`),
			[]WorkerModule{{Name: "setup.mjs", Content: []byte("export default {}")}}, nil, func(next ProvisionState) error { state = next; return nil })
		return err
	}
	if call() == nil || state.WorkerPending == nil {
		t.Fatal("lost update not recorded")
	}
	if err := call(); err != nil {
		t.Fatal(err)
	}
	if state.WorkerPending != nil || state.Workers["bootstrap"] != "owned-tag" || writes != 2 {
		t.Fatal("repair did not converge")
	}
	if err := call(); err != nil || writes != 2 {
		t.Fatal("repeat changed completed repair")
	}
	foreign = true
	if call() == nil || writes != 2 {
		t.Fatal("foreign worker accepted")
	}
}
