package platform

import (
	"bytes"
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestSiteAddressesAreValidatedReservedAndNeverShared(t *testing.T) {
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
	s := &Server{DB: db, Key: bytes.Repeat([]byte{7}, 32), Origin: "https://portal.test", SiteDomain: "example.pt", SiteZone: strings.Repeat("c", 32)}
	type buyer struct{ customer, order, access string }
	newBuyer := func() buyer {
		b := buyer{ID(), ID(), ID()}
		if _, e := db.Exec("INSERT INTO portal_customers VALUES ($1,'buyer',$2)", b.customer, digest(b.access)); e != nil {
			t.Fatal(e)
		}
		if _, e := db.Exec("INSERT INTO portal_orders(id,customer_id,mode,active_until) VALUES ($1,$2,'platform',now()+interval '1 day')", b.order, b.customer); e != nil {
			t.Fatal(e)
		}
		return b
	}
	install := func(b buyer, slug string) int {
		r := httptest.NewRequest(http.MethodPost, "/install", strings.NewReader(`{"order":"`+b.order+`","business":{"name":"Test"},"costsApproved":true,"slug":"`+slug+`"}`))
		r.Header.Set("Origin", s.Origin)
		r.Header.Set("Authorization", "Bearer "+b.access)
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		return w.Code
	}
	jobs := func(b buyer) int {
		var n int
		if e := db.QueryRow("SELECT count(*) FROM portal_jobs WHERE order_id=$1", b.order).Scan(&n); e != nil {
			t.Fatal(e)
		}
		return n
	}
	slug := "bella-" + strings.ToLower(ID()[:8])
	first, second := newBuyer(), newBuyer()
	for _, bad := range []string{"", "ab", "Bella", "admin", "bella-gestao", "a b"} {
		if install(first, bad) != 400 {
			t.Fatalf("%q accepted", bad)
		}
	}
	if jobs(first) != 0 {
		t.Fatal("a refused address still queued an installation")
	}
	if install(first, slug) != 202 || jobs(first) != 1 {
		t.Fatal("valid address was not accepted")
	}
	if install(second, slug) != 409 || jobs(second) != 0 {
		t.Fatal("an address already in use was shared")
	}
	if install(first, slug) != 202 {
		t.Fatal("the owner could not repeat its own request")
	}
	if install(first, "other-"+slug) != 202 {
		t.Fatal("repeat with another address failed")
	}
	got, e := s.JobSlug(context.Background(), jobID(t, db, first.order))
	if e != nil || got != slug {
		t.Fatalf("an order must keep its first address, got %q (%v)", got, e)
	}
	// Orders without a reserved address (created before addresses existed) fall back to workers.dev.
	legacy := newBuyer()
	if _, e := db.Exec("INSERT INTO portal_jobs(id,order_id,state) VALUES ($1,$2,'queued')", ID(), legacy.order); e != nil {
		t.Fatal(e)
	}
	if got, e := s.JobSlug(context.Background(), jobID(t, db, legacy.order)); e != nil || got != "" {
		t.Fatalf("unexpected address for legacy order: %q %v", got, e)
	}
}

func jobID(t *testing.T, db *sql.DB, order string) string {
	t.Helper()
	var id string
	if e := db.QueryRow("SELECT id FROM portal_jobs WHERE order_id=$1", order).Scan(&id); e != nil {
		t.Fatal(e)
	}
	return id
}

func TestSlugCheckReportsAvailabilityToSignedInCustomersOnly(t *testing.T) {
	db := testDatabase(t)
	s := &Server{DB: db, Key: bytes.Repeat([]byte{8}, 32), Origin: "https://portal.test", SiteDomain: "example.pt"}
	customer, order, access := ID(), ID(), ID()
	db.Exec("INSERT INTO portal_customers(id,name,access_hash,email) VALUES ($1,'c',$2,$3)", customer, digest(access), customer+"@example.test")
	db.Exec("INSERT INTO portal_orders(id,customer_id,mode,active_until,simulated) VALUES ($1,$2,'platform',now()+interval '1 day',false)", order, customer)
	taken := "taken-" + strings.ToLower(ID()[:6])
	db.Exec("INSERT INTO portal_slugs(slug,order_id) VALUES ($1,$2)", taken, order)
	check := func(token, slug string) (int, string) {
		r := httptest.NewRequest(http.MethodGet, "/slugs/check?slug="+slug, nil)
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		return w.Code, w.Body.String()
	}
	if code, _ := check("", "free-name"); code != 401 {
		t.Fatalf("anonymous visitors must not probe addresses: %d", code)
	}
	for slug, want := range map[string]string{"free-name": `"available":true`, taken: `"reason":"taken"`, "admin": `"reason":"invalid"`, "": `"available":false`} {
		if code, body := check(access, slug); code != 200 || !strings.Contains(body, want) || !strings.Contains(body, `"domain":"example.pt"`) {
			t.Errorf("%q: %d %s (want %s)", slug, code, body, want)
		}
	}
}
