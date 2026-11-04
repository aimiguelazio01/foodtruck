package cloudflare

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestApplicationPublicationResumesWithoutUploadingAgain(t *testing.T) {
	pkg := t.TempDir()
	files := map[string]any{}
	workers := map[string]any{}
	for _, role := range []string{"api", "customer", "management"} {
		if err := os.MkdirAll(filepath.Join(pkg, role, "assets"), 0700); err != nil {
			t.Fatal(err)
		}
		entry := role + "/entry.mjs"
		worker := map[string]string{"entry": entry, "visibility": "private"}
		contents := map[string][]byte{entry: []byte("export default {}")}
		if role != "api" {
			worker["visibility"] = "public"
			worker["assets"] = role + "/assets"
			contents[role+"/assets/hello.txt"] = []byte("hello")
		}
		workers[role] = worker
		for name, data := range contents {
			if err := os.WriteFile(filepath.Join(pkg, name), data, 0600); err != nil {
				t.Fatal(err)
			}
			files[name] = map[string]any{"bytes": len(data), "sha256": fmt.Sprintf("%x", sha256.Sum256(data))}
		}
	}
	manifest, _ := json.Marshal(map[string]any{"format": 1, "application": licenseApplication, "version": "test", "status": "integration-preview", "workers": workers, "files": files})
	if err := os.WriteFile(filepath.Join(pkg, "manifest.json"), manifest, 0600); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	state, _ := NewProvisionState(strings.Repeat("a", 32))
	state.DatabaseID = "database"
	state.BucketName = state.Name
	state.BootstrapCompleted = true
	state.TemporaryDeleted = map[string]bool{"bridge": true, "bootstrap": true}
	if err := writeJournal(filepath.Join(dir, "provision.json"), state); err != nil {
		t.Fatal(err)
	}
	client := New("test-token")
	tags := map[string][]string{}
	exposure := map[string]subdomainSettings{}
	uploads := 0
	schedules := []workerSchedule{}
	client.http.Transport = transport(func(req *http.Request) (*http.Response, error) {
		if strings.HasSuffix(req.URL.Host, ".workers.dev") {
			if req.Header.Get("Authorization") != "" {
				t.Fatal("Cloudflare credential was sent to an application endpoint")
			}
			body, contentType := `{"configured":true,"demo":false,"readOnly":false}`, "application/json"
			if req.URL.Path == "/" {
				body, contentType = "<!doctype html><title>Food Truck Live</title>", "text/html"
			}
			return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{contentType}}, Body: io.NopCloser(strings.NewReader(body))}, nil
		}
		status := 200
		var result any = map[string]string{"subdomain": "my-account"}
		prefix := "/client/v4/accounts/" + state.Account + "/workers/scripts/"
		if strings.HasPrefix(req.URL.Path, prefix) {
			parts := strings.Split(strings.TrimPrefix(req.URL.Path, prefix), "/")
			name := parts[0]
			if len(parts) == 1 && req.Method == http.MethodPut {
				uploads++
				_, params, _ := mime.ParseMediaType(req.Header.Get("Content-Type"))
				part, err := multipart.NewReader(req.Body, params["boundary"]).NextPart()
				if err != nil {
					t.Fatal(err)
				}
				var config struct {
					Tags []string `json:"tags"`
				}
				if err := json.NewDecoder(part).Decode(&config); err != nil {
					t.Fatal(err)
				}
				tags[name] = config.Tags
				exposure[name] = subdomainSettings{Enabled: true, Previews: true}
			} else if len(parts) == 2 {
				switch parts[1] {
				case "script-settings":
					if tags[name] == nil {
						status = 404
					} else {
						result = map[string]any{"tags": tags[name]}
					}
				case "assets-upload-session":
					result = map[string]any{"jwt": "completion", "buckets": [][]string{}}
				case "subdomain":
					if req.Method == http.MethodPost {
						var value subdomainSettings
						if err := json.NewDecoder(req.Body).Decode(&value); err != nil {
							t.Fatal(err)
						}
						exposure[name] = value
					}
					result = exposure[name]
				case "schedules":
					if req.Method == http.MethodPut {
						if err := json.NewDecoder(req.Body).Decode(&schedules); err != nil {
							t.Fatal(err)
						}
					}
					result = map[string]any{"schedules": schedules}
				default:
					t.Fatalf("unexpected API endpoint %s", req.URL.Path)
				}
			}
		}
		data, _ := json.Marshal(map[string]any{"success": status == 200, "result": result})
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(string(data)))}, nil
	})
	ctx := context.Background()
	if _, err := client.PublishApplicationFromJournal(ctx, dir, pkg, state.Account, ApplicationPublishOptions{}); err == nil {
		t.Fatal("preview package published without integration opt-in")
	}
	for range 2 {
		result, err := client.PublishApplicationFromJournal(ctx, dir, pkg, state.Account, ApplicationPublishOptions{AllowIntegrationPreview: true})
		if err != nil || result.Customer != "https://"+state.Name+"-customer.my-account.workers.dev" {
			t.Fatalf("publication failed: %+v %v", result, err)
		}
	}
	if uploads != 3 || exposure[state.Name+"-api"].Enabled || !exposure[state.Name+"-customer"].Enabled || exposure[state.Name+"-management"].Previews {
		t.Fatalf("unexpected uploads or public exposure: %d %+v", uploads, exposure)
	}
	if len(schedules) != 1 || schedules[0].Cron != "* * * * *" {
		t.Fatalf("unexpected maintenance schedule: %+v", schedules)
	}
}
