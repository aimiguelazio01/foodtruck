package platform

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	_ "github.com/jackc/pgx/v5/stdlib"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestPostgresIsolationAndQueue(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("isolated PostgreSQL required")
	}
	db, e := sql.Open("pgx", url)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	if _, e = db.Exec(Schema); e != nil {
		t.Fatal(e)
	}
	s := &Server{DB: db, Key: bytes.Repeat([]byte{4}, 32), Origin: "https://portal.test"}
	customer, order, access := ID(), ID(), ID()
	if _, e = db.Exec("INSERT INTO portal_customers VALUES ($1,'test',$2)", customer, digest(access)); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("INSERT INTO portal_orders(id,customer_id,mode,active_until) VALUES ($1,$2,'platform',now()+interval '1 day')", order, customer); e != nil {
		t.Fatal(e)
	}
	call := func(id string) int {
		r := httptest.NewRequest(http.MethodPost, "/install", strings.NewReader(`{"order":"`+id+`","business":{"name":"Test"},"costsApproved":true}`))
		r.Header.Set("Origin", s.Origin)
		r.Header.Set("Authorization", "Bearer "+access)
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		return w.Code
	}
	if call(ID()) != 404 {
		t.Fatal("foreign order accepted")
	}
	if call(order) != 202 || call(order) != 202 {
		t.Fatal("enqueue failed")
	}
	var count int
	if e = db.QueryRow("SELECT count(*) FROM portal_jobs WHERE order_id=$1", order).Scan(&count); e != nil || count != 1 {
		t.Fatal("duplicate job")
	}
	// A blocked task must be explicitly resumed, keeping its original payload and ID.
	if err := s.RunOne(context.Background(), func(context.Context, string, []byte) (any, error) {
		return nil, fmt.Errorf("simulated network failure")
	}); err != nil {
		t.Fatal(err)
	}
	action := func(value string) int {
		r := httptest.NewRequest("POST", "/jobs/action", strings.NewReader(`{"order":"`+order+`","action":"`+value+`"}`))
		r.Header.Set("Origin", s.Origin)
		r.Header.Set("Authorization", "Bearer "+access)
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		return w.Code
	}
	if action("resume") != 200 {
		t.Fatal("blocked task could not resume")
	}
	if action("cancel") != 200 {
		t.Fatal("queued task could not cancel")
	}
	if action("resume") != 200 {
		t.Fatal("cancelled task could not resume")
	}
	runs := 0
	deploy := func(_ context.Context, _ string, body []byte) (any, error) {
		runs++
		if e := s.RecordProgress(context.Background(), jobIDForOrder(t, db, order), "publish-api"); e != nil {
			t.Fatal(e)
		}
		if !bytes.Contains(body, []byte("Test")) {
			t.Fatal("payload lost")
		}
		return map[string]string{"customer": "https://test.workers.dev"}, nil
	}
	if e = s.RunOne(context.Background(), deploy); e != nil {
		t.Fatal(e)
	}
	if e = s.RunOne(context.Background(), deploy); e != nil {
		t.Fatal(e)
	}
	if runs != 1 {
		t.Fatal("deployment repeated")
	}
	var payload []byte
	var state string
	if e = db.QueryRow("SELECT state,payload FROM portal_jobs WHERE order_id=$1", order).Scan(&state, &payload); e != nil || state != "ready" || payload != nil {
		t.Fatal("credentials retained after success")
	}
}

func jobIDForOrder(t *testing.T, db *sql.DB, order string) string {
	t.Helper()
	var id string
	if e := db.QueryRow("SELECT id FROM portal_jobs WHERE order_id=$1", order).Scan(&id); e != nil {
		t.Fatal(e)
	}
	return id
}
