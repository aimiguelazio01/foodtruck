package cloudflare

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestVerifyDeploymentPackage(t *testing.T) {
	dir := t.TempDir()
	files := map[string]any{}
	workers := map[string]any{}
	for _, role := range []string{"api", "customer", "management"} {
		if err := os.Mkdir(filepath.Join(dir, role), 0700); err != nil {
			t.Fatal(err)
		}
		entry := role + "/worker.mjs"
		content := []byte("export default {}")
		if err := os.WriteFile(filepath.Join(dir, entry), content, 0600); err != nil {
			t.Fatal(err)
		}
		files[entry] = map[string]any{"bytes": len(content), "sha256": fmt.Sprintf("%x", sha256.Sum256(content))}
		worker := map[string]string{"entry": entry, "visibility": "private"}
		if role != "api" {
			worker["visibility"] = "public"
			worker["assets"] = role + "/assets"
		}
		workers[role] = worker
	}
	manifest, err := json.Marshal(map[string]any{"format": 1, "application": licenseApplication,
		"version": "1.0.0", "workers": workers, "files": files})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), manifest, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyDeploymentPackage(dir); err != nil {
		t.Fatal(err)
	}
	if payload, err := LoadPackageWorker(dir, "api"); err != nil || payload.Module.Name != "worker.mjs" {
		t.Fatalf("API package failed to load: %+v %v", payload, err)
	}
	if err := os.WriteFile(filepath.Join(dir, "api", "worker.mjs"), []byte("tampered"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyDeploymentPackage(dir); err == nil {
		t.Fatal("tampered package was accepted")
	}
	if _, err := LoadPackageWorker(dir, "api"); err == nil {
		t.Fatal("tampered module was loaded")
	}
}

func TestGeneratedDeploymentPackage(t *testing.T) {
	dir := os.Getenv("FOODTRUCK_TEST_DEPLOYMENT_PACKAGE")
	if dir == "" {
		t.Skip("no generated package supplied")
	}
	manifest, err := VerifyDeploymentPackage(dir)
	if err != nil {
		t.Fatal(err)
	}
	for role := range manifest.Workers {
		payload, err := LoadPackageWorker(dir, role)
		if err != nil {
			t.Fatalf("%s: %v", role, err)
		}
		if len(payload.Module.Content) == 0 || (role == "customer" || role == "management") && len(payload.Assets) == 0 {
			t.Fatalf("incomplete %s package", role)
		}
	}
}
