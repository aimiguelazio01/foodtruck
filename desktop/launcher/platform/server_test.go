package platform

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEncryptionBoundToJob(t *testing.T) {
	key := bytes.Repeat([]byte{7}, 32)
	secret := []byte("administrator password")
	sealed, e := Seal(key, secret, "job-a")
	if e != nil {
		t.Fatal(e)
	}
	plain, e := Open(key, sealed, "job-a")
	if e != nil || !bytes.Equal(plain, secret) {
		t.Fatal("roundtrip failed")
	}
	if _, e = Open(key, sealed, "job-b"); e == nil {
		t.Fatal("ciphertext can be moved between jobs")
	}
	sealed[len(sealed)-1] ^= 1
	if _, e = Open(key, sealed, "job-a"); e == nil {
		t.Fatal("tampering accepted")
	}
}
func TestCrossOriginAndAnonymousAdminDenied(t *testing.T) {
	s := &Server{Origin: "https://portal.example"}
	r := httptest.NewRequest(http.MethodPost, "/install", nil)
	r.Header.Set("Origin", "https://evil.example")
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal(w.Code)
	}
	r = httptest.NewRequest(http.MethodPost, "/admin/orders", nil)
	r.Header.Set("Origin", s.Origin)
	w = httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatal(w.Code)
	}
}
