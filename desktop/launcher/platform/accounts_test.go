package platform

import (
	"bytes"
	"context"
	"database/sql"
	"foodtruck.local/desktop/cloudflare"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestCustomerAccountBinding(t *testing.T) {
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
	customer, order, access := ID(), ID(), ID()
	a, b := strings.Repeat("a", 32), strings.Repeat("b", 32)
	s := &Server{DB: db, Key: bytes.Repeat([]byte{9}, 32), Origin: "https://portal.test", Accounts: func(_ context.Context, token string) ([]cloudflare.Account, error) {
		if token != "test-oauth-secret" {
			t.Fatal("wrong customer token")
		}
		return []cloudflare.Account{{ID: a, Name: "A"}, {ID: b, Name: "B"}}, nil
	}}
	if _, e = db.Exec("INSERT INTO portal_customers VALUES ($1,'test',$2)", customer, digest(access)); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("INSERT INTO portal_orders(id,customer_id,mode,active_until) VALUES ($1,$2,'customer',now()+interval '1 day')", order, customer); e != nil {
		t.Fatal(e)
	}
	call := func(account string) int {
		r := httptest.NewRequest("POST", "/install", strings.NewReader(`{"order":"`+order+`","account":"`+account+`","business":{"name":"Cloud truck"},"costsApproved":true}`))
		r.Header.Set("Origin", s.Origin)
		r.Header.Set("Authorization", "Bearer "+access)
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		return w.Code
	}
	if call(a) != 409 {
		t.Fatal("missing authorization accepted")
	}
	encrypted, e := Seal(s.Key, []byte(`{"access_token":"test-oauth-secret"}`), customer)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("INSERT INTO portal_oauth_tokens VALUES ($1,$2,now()+interval '1 hour')", customer, encrypted); e != nil {
		t.Fatal(e)
	}
	if call(strings.Repeat("c", 32)) != 403 {
		t.Fatal("unlisted account accepted")
	}
	if call(a) != 202 || call(a) != 202 {
		t.Fatal("valid account could not enqueue")
	}
	if call(b) != 409 {
		t.Fatal("account changed after enqueue")
	}
	var job string
	if db.QueryRow("SELECT id FROM portal_jobs WHERE order_id=$1", order).Scan(&job) != nil {
		t.Fatal("job missing")
	}
	account, token, hosted, e := s.JobCredentials(context.Background(), job)
	if e != nil || !hosted || account != a || token != "test-oauth-secret" {
		t.Fatal("runner credentials not bound to order")
	}
	if _, e = db.Exec("UPDATE portal_oauth_tokens SET expires_at=now() WHERE customer_id=$1", customer); e != nil {
		t.Fatal(e)
	}
	if _, _, _, e = s.JobCredentials(context.Background(), job); e != ErrAuthorization {
		t.Fatal("expired token accepted")
	}
	// Keep this test's unexecuted job out of other runner tests.
	if _, e = db.Exec("UPDATE portal_jobs SET state='cancelled' WHERE id=$1", job); e != nil {
		t.Fatal(e)
	}
}
