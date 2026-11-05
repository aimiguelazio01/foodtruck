package platform

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestPortalPasswordHash(t *testing.T) {
	password := "long test password with unicode ç"
	first := passwordHash(password)
	second := passwordHash(password)
	if first == second || !passwordMatches(password, first) || passwordMatches("wrong", first) || passwordMatches(password, "malformed") {
		t.Fatal("password hashing failed")
	}
}
func TestPortalActivationSessionsAndLogout(t *testing.T) {
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
	s := &Server{DB: db, Origin: "https://portal.test"}
	customer, access, order := ID(), ID(), ID()
	email := "user-" + ID() + "@example.test"
	if _, e = db.Exec("INSERT INTO portal_customers(id,name,access_hash) VALUES ($1,'test',$2)", customer, digest(access)); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("INSERT INTO portal_orders(id,customer_id,mode,active_until) VALUES ($1,$2,'platform',now()+interval '1 day')", order, customer); e != nil {
		t.Fatal(e)
	}
	send := func(path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
		method := "POST"
		if path == "/orders" {
			method = "GET"
		}
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Origin", s.Origin)
		if cookie != nil {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		return w
	}
	body := `{"code":"` + access + `","email":"` + email + `","password":"strong portal password"}`
	activation := send("/auth/activate", body, nil)
	if activation.Code != 200 {
		t.Fatal(activation.Body.String())
	}
	cookies := activation.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || !cookies[0].Secure || cookies[0].SameSite != http.SameSiteLaxMode {
		t.Fatal("unsafe session cookie")
	}
	cookie := cookies[0]
	if send("/orders", "", cookie).Code != 200 || send("/orders", "", nil).Code != 401 {
		t.Fatal("session authentication failed")
	}
	if send("/auth/activate", body, nil).Code != 401 {
		t.Fatal("activation code replay accepted")
	}
	r := httptest.NewRequest("GET", "/orders", nil)
	r.Header.Set("Authorization", "Bearer "+access)
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatal("activation code was not invalidated")
	}
	if send("/auth/logout", "{}", cookie).Code != 200 || send("/orders", "", cookie).Code != 401 {
		t.Fatal("logout did not revoke session")
	}
	login := send("/auth/login", body, nil)
	if login.Code != 200 {
		t.Fatal(login.Body.String())
	}
	cookie = login.Result().Cookies()[0]
	if _, e = db.Exec("UPDATE portal_sessions SET expires_at=now()-interval '1 second' WHERE hash=$1", digest(cookie.Value)); e != nil {
		t.Fatal(e)
	}
	if send("/orders", "", cookie).Code != 401 {
		t.Fatal("expired session accepted")
	}
}
