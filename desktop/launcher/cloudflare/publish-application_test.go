package cloudflare

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
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

func TestLicensedInstallationResumesAfterLostBootstrapResponse(t *testing.T) {
	pkg := t.TempDir()
	files := map[string]any{}
	workers := map[string]any{}
	for _, role := range []string{"api", "customer", "management", "bootstrap", "bridge"} {
		if err := os.MkdirAll(filepath.Join(pkg, role, "assets"), 0700); err != nil {
			t.Fatal(err)
		}
		entry := role + "/entry.mjs"
		worker := map[string]any{"entry": entry, "visibility": "private"}
		contents := map[string][]byte{entry: []byte("export default {}")}
		if role == "customer" || role == "management" {
			worker["visibility"] = "public"
			worker["assets"] = role + "/assets"
			contents[role+"/assets/hello.txt"] = []byte("hello")
		}
		if role == "bootstrap" || role == "bridge" {
			worker["temporary"] = true
		}
		if role == "bridge" {
			worker["visibility"] = "public"
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
	public, private, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	encode := base64.RawURLEncoding.EncodeToString
	if err := os.WriteFile(filepath.Join(pkg, "manifest.signature"), []byte(encode(ed25519.Sign(private, DeploymentSigningMessage(manifest)))), 0600); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	state, _ := NewProvisionState(strings.Repeat("a", 32))
	dir := filepath.Join(root, fmt.Sprintf("%x", sha256.Sum256([]byte(state.Account+"\ntest-order"))))
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := writeJournal(filepath.Join(dir, "provision.json"), state); err != nil {
		t.Fatal(err)
	}
	claims, _ := json.Marshal(License{Version: 1, Product: licenseApplication, Account: state.Account, OrderID: "test-order"})
	license, _ := json.Marshal(map[string]string{"payload": encode(claims), "signature": encode(ed25519.Sign(private, claims))})
	client := New("test-token")
	tags := map[string][]string{}
	exposure := map[string]subdomainSettings{}
	uploads := 0
	databaseCreates, bucketCreates, bootstraps, deletes, requests := 0, 0, 0, 0, 0
	var bootstrapToken string
	schedules := []workerSchedule{}
	client.http.Transport = transport(func(req *http.Request) (*http.Response, error) {
		requests++
		if strings.HasSuffix(req.URL.Host, ".workers.dev") {
			if req.Header.Get("Authorization") != "" {
				t.Fatal("Cloudflare credential was sent to an application endpoint")
			}
			body, contentType := `{"configured":true,"demo":false,"readOnly":false}`, "application/json"
			if req.URL.Path == "/initialize" {
				if !exposure[state.Name+"-bridge"].Enabled || exposure[state.Name+"-bootstrap"].Enabled || bootstrapToken == "" || req.Header.Get("x-install-token") != bootstrapToken {
					t.Fatal("invalid bootstrap exposure or credential")
				}
				bootstraps++
				if bootstraps == 1 {
					return nil, errors.New("response lost")
				}
				body = fmt.Sprintf(`{"ok":true,"installation":%q}`, state.Name)
			}
			if req.URL.Path == "/" {
				body, contentType = "<!doctype html><title>Food Truck Live</title>", "text/html"
			}
			return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{contentType}}, Body: io.NopCloser(strings.NewReader(body))}, nil
		}
		status := 200
		var result any = map[string]string{"subdomain": "my-account"}
		switch {
		case strings.HasSuffix(req.URL.Path, "/d1/database"):
			result = []Database{}
			if req.Method == http.MethodPost {
				databaseCreates++
				result = Database{ID: "database", Name: state.Name}
			}
		case strings.HasSuffix(req.URL.Path, "/r2/buckets"):
			bucketCreates++
			result = Bucket{Name: state.Name}
		}
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
					Tags     []string            `json:"tags"`
					Bindings []map[string]string `json:"bindings"`
				}
				if err := json.NewDecoder(part).Decode(&config); err != nil {
					t.Fatal(err)
				}
				tags[name] = config.Tags
				for _, binding := range config.Bindings {
					if strings.HasSuffix(name, "-bridge") && binding["name"] == "INSTALL_TOKEN" {
						bootstrapToken = binding["text"]
					}
				}
				exposure[name] = subdomainSettings{Enabled: true, Previews: true}
			} else if len(parts) == 1 && req.Method == http.MethodDelete {
				if !strings.HasSuffix(name, "-bridge") && !strings.HasSuffix(name, "-bootstrap") {
					t.Fatal("permanent Worker deleted")
				}
				deletes++
				delete(tags, name)
				delete(exposure, name)
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
	options := InstallOptions{PublicKey: public, License: license, Business: []byte(`{"name":"Food Truck"}`)}
	if _, err := client.InstallPilot(ctx, root, pkg, state.Account, "test-order", options); err == nil || requests != 0 {
		t.Fatal("install contacted Cloudflare without cost approval")
	}
	options.CostsApproved = true
	if _, err := client.InstallApplication(ctx, dir, pkg, state.Account, options); err == nil || requests != 0 {
		t.Fatal("preview accepted by commercial installer")
	}
	if _, err := client.InstallPilot(ctx, root, pkg, state.Account, "different-order", options); err == nil || requests != 0 {
		t.Fatal("wrong purchase accepted")
	}
	if _, err := client.InstallPilot(ctx, root, pkg, state.Account, "test-order", options); err == nil || deletes != 0 {
		t.Fatal("lost response was treated as successful")
	}
	for range 2 {
		result, err := client.InstallPilot(ctx, root, pkg, state.Account, "test-order", options)
		if err != nil || result.Customer != "https://"+state.Name+"-customer.my-account.workers.dev" {
			t.Fatalf("publication failed: %+v %v", result, err)
		}
	}
	if uploads != 5 || databaseCreates != 1 || bucketCreates != 1 || bootstraps != 2 || deletes != 2 || exposure[state.Name+"-api"].Enabled || !exposure[state.Name+"-customer"].Enabled || exposure[state.Name+"-management"].Previews {
		t.Fatalf("unexpected uploads or public exposure: %d %+v", uploads, exposure)
	}
	if len(schedules) != 1 || schedules[0].Cron != "* * * * *" {
		t.Fatalf("unexpected maintenance schedule: %+v", schedules)
	}
}
