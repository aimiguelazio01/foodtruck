package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDemoTokenIsStableLongAndSecretFree(t *testing.T) {
	_, private, _ := ed25519.GenerateKey(nil)
	token := demoToken(private)
	if len(token) < 32 || token != demoToken(private) {
		t.Fatalf("token not stable/long enough: %q", token)
	}
	_, other, _ := ed25519.GenerateKey(nil)
	if demoToken(other) == token {
		t.Fatal("different keys gave the same token")
	}
}

func TestPutDemoSeedSendsTheTokenAndStopsOnRefusal(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != http.MethodPut || r.URL.Path != "/api/v1/demo/seed" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("x-demo-token") != "good-token" {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"message":"Token da demonstração inválido."}`))
			return
		}
		_, _ = w.Write([]byte(`{"reset":true,"statements":900}`))
	}))
	defer server.Close()
	var out bytes.Buffer
	if err := putDemoSeed(context.Background(), server.Client(), server.URL, "good-token", []byte("{}"), &out); err != nil || !strings.Contains(out.String(), "900") {
		t.Fatalf("seed not accepted: %v %q", err, out.String())
	}
	calls = 0
	if err := putDemoSeed(context.Background(), server.Client(), server.URL, "bad-token", []byte("{}"), &out); err == nil || calls != 1 {
		t.Fatalf("a refused token must fail at once, got err=%v after %d calls", err, calls)
	}
}

func TestAppendEnvSetsAndAddsLinesWithoutTouchingTheRest(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(path, []byte("A=1\nPLATFORM_DEMO_CUSTOMER_URL=old\nB=2\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := appendEnv(path, map[string]string{"PLATFORM_DEMO_CUSTOMER_URL": "https://new", "PLATFORM_DEMO_MANAGEMENT_URL": "https://manage"}); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(path)
	text := string(data)
	if !strings.Contains(text, "A=1\n") || !strings.Contains(text, "B=2\n") || !strings.Contains(text, "PLATFORM_DEMO_CUSTOMER_URL=https://new") ||
		!strings.Contains(text, "PLATFORM_DEMO_MANAGEMENT_URL=https://manage") || strings.Contains(text, "=old") {
		t.Fatalf("unexpected .env:\n%s", text)
	}
}
