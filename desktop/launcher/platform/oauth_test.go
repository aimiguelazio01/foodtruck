package platform

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
)

type oauthTransport func(*http.Request) (*http.Response, error)

func (f oauthTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestOAuthBrowserBindingAndReplay(t *testing.T) {
	if os.Getenv("DATABASE_URL") == "" {
		t.Skip("isolated PostgreSQL required")
	}
	db, e := sql.Open("pgx", os.Getenv("DATABASE_URL"))
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	if _, e = db.Exec(Schema); e != nil {
		t.Fatal(e)
	}
	customer := ID()
	if _, e = db.Exec("INSERT INTO portal_customers VALUES ($1,'OAuth test',$2)", customer, ID()); e != nil {
		t.Fatal(e)
	}
	exchanges := 0
	s := &Server{DB: db, Key: bytes.Repeat([]byte{8}, 32), Origin: "https://portal.test", OAuth: OAuthConfig{ClientID: "test-client", Scopes: "test-scope"}}
	s.OAuth.HTTP = &http.Client{Transport: oauthTransport(func(r *http.Request) (*http.Response, error) {
		exchanges++
		if r.URL.String() != "https://dash.cloudflare.com/oauth2/token" {
			t.Fatal("incorrect endpoint")
		}
		if r.ParseForm() != nil || len(r.Form.Get("code_verifier")) != 48 {
			t.Fatal("PKCE missing")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"access_token":"test-secret-token","token_type":"bearer","expires_in":3600}`))}, nil
	})}
	w := httptest.NewRecorder()
	s.oauthStart(w, httptest.NewRequest("POST", "/oauth/start", nil), customer)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var start struct {
		URL string `json:"url"`
	}
	json.Unmarshal(w.Body.Bytes(), &start)
	target, _ := url.Parse(start.URL)
	if target.Query().Get("code_challenge_method") != "S256" {
		t.Fatal("PKCE missing")
	}
	callback := "/oauth/callback?state=" + target.Query().Get("state") + "&code=test-code"
	invoke := func(cookie bool) int {
		r := httptest.NewRequest("GET", callback, nil)
		if cookie {
			r.AddCookie(w.Result().Cookies()[0])
		}
		out := httptest.NewRecorder()
		s.oauthCallback(out, r)
		return out.Code
	}
	if invoke(false) != 400 || exchanges != 0 {
		t.Fatal("unbound browser accepted")
	}
	if invoke(true) != 303 || exchanges != 1 {
		t.Fatal("callback failed")
	}
	if invoke(true) != 400 || exchanges != 1 {
		t.Fatal("callback replay accepted")
	}
	var encrypted []byte
	if db.QueryRow("SELECT token FROM portal_oauth_tokens WHERE customer_id=$1", customer).Scan(&encrypted) != nil {
		t.Fatal("token missing")
	}
	if bytes.Contains(encrypted, []byte("test-secret-token")) {
		t.Fatal("plaintext token persisted")
	}
}
