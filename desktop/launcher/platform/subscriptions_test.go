package platform

import (
	"bytes"
	"context"
	"database/sql"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestSubscriptionPeriodAndReactivation(t *testing.T) {
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
	s := &Server{DB: db, Key: bytes.Repeat([]byte{3}, 32), Origin: "https://portal.test"}
	customer, order, job := ID(), ID(), ID()
	if _, e = db.Exec("INSERT INTO portal_customers VALUES ($1,'subscriber',$2)", customer, ID()); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("INSERT INTO portal_orders(id,customer_id,mode,active_until) VALUES ($1,$2,'platform',now()+interval '1 day')", order, customer); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("INSERT INTO portal_jobs(id,order_id,state) VALUES ($1,$2,'ready')", job, order); e != nil {
		t.Fatal(e)
	}
	token, e := s.HostingGrant(context.Background(), job)
	if e != nil {
		t.Fatal(e)
	}
	again, e := s.HostingGrant(context.Background(), job)
	if e != nil || token != again {
		t.Fatal("unstable hosting credential")
	}
	status := func() string {
		r := httptest.NewRequest("GET", "/hosting/status", nil)
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		s.hostingStatus(w, r)
		return w.Body.String()
	}
	action := func(actor, action string, admin bool) int {
		r := httptest.NewRequest("POST", "/subscriptions/action", strings.NewReader(`{"order":"`+order+`","action":"`+action+`"}`))
		w := httptest.NewRecorder()
		s.subscriptionAction(w, r, actor, admin)
		return w.Code
	}
	if action(ID(), "cancel", false) != 404 {
		t.Fatal("cross-tenant cancellation accepted")
	}
	if action(customer, "cancel", false) != 200 || !strings.Contains(status(), `"active":true`) {
		t.Fatal("cancellation ended paid period early")
	}
	if _, e = db.Exec("UPDATE portal_orders SET active_until=now()-interval '1 day' WHERE id=$1", order); e != nil {
		t.Fatal(e)
	}
	if !strings.Contains(status(), `"active":false`) {
		t.Fatal("expired subscription active")
	}
	if action(customer, "reactivate", false) != 403 {
		t.Fatal("customer renewed simulated subscription")
	}
	if action("operator", "reactivate", true) != 200 || !strings.Contains(status(), `"active":true`) {
		t.Fatal("reactivation failed")
	}
}
