package platform

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"
)

func sign(secret string, body []byte, at time.Time) string {
	stamp := fmt.Sprint(at.Unix())
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(stamp + "."))
	mac.Write(body)
	return "t=" + stamp + ",v1=" + hex.EncodeToString(mac.Sum(nil))
}

func TestStripeSignatureChecks(t *testing.T) {
	body := []byte(`{"id":"evt_1"}`)
	now := time.Now()
	if !verifyStripeSignature("whsec", sign("whsec", body, now), body, now) {
		t.Fatal("valid signature refused")
	}
	for name, header := range map[string]string{
		"wrong secret": sign("other", body, now),
		"stale":        sign("whsec", body, now.Add(-10*time.Minute)),
		"future":       sign("whsec", body, now.Add(10*time.Minute)),
		"empty":        "",
		"no v1":        "t=" + fmt.Sprint(now.Unix()),
	} {
		if verifyStripeSignature("whsec", header, body, now) {
			t.Errorf("%s accepted", name)
		}
	}
	if verifyStripeSignature("whsec", sign("whsec", []byte(`{"id":"evt_2"}`), now), body, now) {
		t.Error("signature for a different body accepted")
	}
	if verifyStripeSignature("", sign("", body, now), body, now) {
		t.Error("an unset secret must never validate")
	}
}

func testDatabase(t *testing.T) *sql.DB {
	t.Helper()
	address := os.Getenv("DATABASE_URL")
	if address == "" {
		t.Skip("isolated PostgreSQL required")
	}
	db, e := sql.Open("pgx", address)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { db.Close() })
	if _, e = db.Exec(Schema); e != nil {
		t.Fatal(e)
	}
	return db
}

func TestSignupVerifiesEmailStartsOneTrialAndSignsIn(t *testing.T) {
	db := testDatabase(t)
	var sent []string
	s := &Server{DB: db, Key: bytes.Repeat([]byte{1}, 32), Origin: "https://portal.test", TrialDays: 7,
		Mail: func(_ context.Context, to, _, text string) error { sent = append(sent, to+"\n"+text); return nil }}
	email := "ana-" + strings.ToLower(ID()[:8]) + "@example.test"
	post := func(path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		r.Header.Set("Origin", s.Origin)
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		return w
	}
	password := "a long enough password"
	if post("/auth/signup", `{"email":"nope","password":"`+password+`"}`).Code != 400 || post("/auth/signup", `{"email":"`+email+`","password":"short"}`).Code != 400 {
		t.Fatal("invalid signup accepted")
	}
	if post("/auth/signup", `{"email":"`+email+`","password":"`+password+`"}`).Code != 200 || len(sent) != 1 {
		t.Fatal("signup did not send the confirmation")
	}
	token := regexp.MustCompile(`verify=([0-9a-f]{48})`).FindStringSubmatch(sent[0])[1]
	if !strings.HasPrefix(sent[0], email+"\n") {
		t.Fatal("confirmation sent to the wrong address")
	}
	if post("/auth/login", `{"email":"`+email+`","password":"`+password+`"}`).Code != 401 {
		t.Fatal("an unconfirmed account could sign in")
	}
	var orders int
	db.QueryRow("SELECT count(*) FROM portal_orders o JOIN portal_customers c ON c.id=o.customer_id WHERE c.email=$1", email).Scan(&orders)
	if orders != 0 {
		t.Fatal("trial started before the email was confirmed")
	}
	if post("/auth/verify", `{"token":"`+strings.Repeat("0", 48)+`"}`).Code != 400 {
		t.Fatal("unknown token accepted")
	}
	verified := post("/auth/verify", `{"token":"`+token+`"}`)
	if verified.Code != 200 || !strings.Contains(verified.Header().Get("Set-Cookie"), "portal_session=") {
		t.Fatalf("verification failed: %d %s", verified.Code, verified.Body)
	}
	if post("/auth/verify", `{"token":"`+token+`"}`).Code != 400 {
		t.Fatal("a confirmation link worked twice")
	}
	var status string
	var days float64
	var simulated bool
	e := db.QueryRow(`SELECT o.plan_status,o.simulated,extract(epoch FROM (o.active_until-now()))/86400 FROM portal_orders o JOIN portal_customers c ON c.id=o.customer_id WHERE c.email=$1`, email).Scan(&status, &simulated, &days)
	if e != nil || status != "trialing" || simulated || days < 6.9 || days > 7.1 {
		t.Fatalf("unexpected trial: %q simulated=%v days=%.2f %v", status, simulated, days, e)
	}
	if post("/auth/login", `{"email":"`+email+`","password":"`+password+`"}`).Code != 200 {
		t.Fatal("confirmed account cannot sign in")
	}
	// Signing up again with a confirmed address must not reveal it, send mail or add a trial.
	if post("/auth/signup", `{"email":"`+email+`","password":"`+password+`"}`).Code != 200 || len(sent) != 1 {
		t.Fatal("repeat signup leaked or re-sent")
	}
	// A failed delivery leaves nothing behind.
	s.Mail = func(context.Context, string, string, string) error { return fmt.Errorf("down") }
	failing := "fail-" + strings.ToLower(ID()[:8]) + "@example.test"
	if post("/auth/signup", `{"email":"`+failing+`","password":"`+password+`"}`).Code != 502 {
		t.Fatal("delivery failure not reported")
	}
	var left int
	db.QueryRow("SELECT count(*) FROM portal_customers WHERE email=$1", failing).Scan(&left)
	if left != 0 {
		t.Fatal("unconfirmable account left behind")
	}
	s.Mail = nil
	s.BrevoKey = ""
	if post("/auth/signup", `{"email":"x`+email+`","password":"`+password+`"}`).Code != 503 {
		t.Fatal("signup must be unavailable without email")
	}
}

func TestStripeBillingLifecycle(t *testing.T) {
	db := testDatabase(t)
	var form url.Values
	var path string
	stripe := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		if r.Header.Get("Authorization") != "Bearer sk_test_x" {
			t.Errorf("missing API key")
		}
		r.ParseForm()
		form = r.PostForm
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"url":"https://checkout.stripe.com/c/pay/cs_test"}`)
	}))
	defer stripe.Close()
	const secret = "whsec_test"
	s := &Server{DB: db, Key: bytes.Repeat([]byte{2}, 32), Origin: "https://portal.test", StripeKey: "sk_test_x", StripeSecret: secret, StripePrice: "price_123", StripeBase: stripe.URL}
	customer, other, order, access, otherAccess := ID(), ID(), ID(), ID(), ID()
	for _, c := range [][2]string{{customer, access}, {other, otherAccess}} {
		if _, e := db.Exec("INSERT INTO portal_customers(id,name,access_hash,email) VALUES ($1,'buyer',$2,$3)", c[0], digest(c[1]), c[0]+"@example.test"); e != nil {
			t.Fatal(e)
		}
	}
	if _, e := db.Exec("INSERT INTO portal_orders(id,customer_id,mode,active_until,simulated,plan_status,trial_ends_at) VALUES ($1,$2,'platform',now()+interval '1 day',false,'trialing',now()+interval '1 day')", order, customer); e != nil {
		t.Fatal(e)
	}
	call := func(path, bearer, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		r.Header.Set("Origin", s.Origin)
		r.Header.Set("Authorization", "Bearer "+bearer)
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		return w
	}
	if call("/billing/checkout", otherAccess, `{"order":"`+order+`"}`).Code != 404 {
		t.Fatal("another customer opened checkout for this order")
	}
	w := call("/billing/checkout", access, `{"order":"`+order+`"}`)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "checkout.stripe.com") || path != "/v1/checkout/sessions" {
		t.Fatalf("checkout failed: %d %s", w.Code, w.Body)
	}
	if form.Get("mode") != "subscription" || form.Get("client_reference_id") != order || form.Get("line_items[0][price]") != "price_123" ||
		form.Get("subscription_data[metadata][order]") != order || form.Get("customer_email") != customer+"@example.test" ||
		form.Get("success_url") != "https://portal.test/?billing=ok" {
		t.Fatalf("unexpected checkout request: %v", form)
	}
	if call("/billing/portal", access, `{"order":"`+order+`"}`).Code != 409 {
		t.Fatal("billing portal opened before any subscription exists")
	}

	webhook := func(body string, header string) int {
		r := httptest.NewRequest(http.MethodPost, "/stripe/webhook", strings.NewReader(body))
		if header != "" {
			r.Header.Set("Stripe-Signature", header)
		}
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		return w.Code
	}
	deliver := func(id, kind, object string) int {
		body := `{"id":"` + id + `","type":"` + kind + `","data":{"object":` + object + `}}`
		return webhook(body, sign(secret, []byte(body), time.Now()))
	}
	state := func() (plan string, days float64, sub string, cancelling bool) {
		var subscription sql.NullString
		if e := db.QueryRow("SELECT plan_status,extract(epoch FROM (active_until-now()))/86400,stripe_subscription_id,cancel_requested FROM portal_orders WHERE id=$1", order).Scan(&plan, &days, &subscription, &cancelling); e != nil {
			t.Fatal(e)
		}
		return plan, days, subscription.String, cancelling
	}
	if webhook(`{"id":"evt_x"}`, "") != 400 || webhook(`{"id":"evt_x"}`, sign("wrong", []byte(`{"id":"evt_x"}`), time.Now())) != 400 {
		t.Fatal("unsigned webhook accepted")
	}
	if deliver("evt_1", "checkout.session.completed", `{"mode":"subscription","client_reference_id":"`+order+`","customer":"cus_1","subscription":"sub_1"}`) != 200 {
		t.Fatal("checkout.session.completed failed")
	}
	if plan, _, sub, _ := state(); plan != "trialing" || sub != "sub_1" {
		t.Fatalf("checkout alone must not mark the order paid: %s %s", plan, sub)
	}
	periodEnd := time.Now().Add(30 * 24 * time.Hour).Unix()
	invoice := `{"customer":"cus_1","subscription":"sub_1","lines":{"data":[{"period":{"end":` + fmt.Sprint(periodEnd) + `}}]}}`
	if deliver("evt_2", "invoice.paid", invoice) != 200 {
		t.Fatal("invoice.paid failed")
	}
	plan, days, _, _ := state()
	if plan != "active" || days < 32.9 || days > 33.1 {
		t.Fatalf("paid period not applied: %s %.2f days", plan, days)
	}
	if deliver("evt_2", "invoice.paid", `{"customer":"cus_1","subscription":"sub_1","lines":{"data":[{"period":{"end":`+fmt.Sprint(periodEnd+86400*365)+`}}]}}`) != 200 {
		t.Fatal("duplicate delivery failed")
	}
	if _, days, _, _ = state(); days > 33.1 {
		t.Fatal("a duplicate event extended the subscription again")
	}
	if call("/billing/checkout", access, `{"order":"`+order+`"}`).Code != 409 {
		t.Fatal("second subscription offered while active")
	}
	if w = call("/billing/portal", access, `{"order":"`+order+`"}`); w.Code != 200 || path != "/v1/billing_portal/sessions" || form.Get("customer") != "cus_1" {
		t.Fatalf("billing portal failed: %d %v", w.Code, form)
	}
	if deliver("evt_3", "invoice.payment_failed", `{"subscription":"sub_1"}`) != 200 {
		t.Fatal("payment_failed not handled")
	}
	if plan, days, _, _ = state(); plan != "past_due" || days < 32.9 {
		t.Fatalf("a failed payment must keep the paid period: %s %.2f", plan, days)
	}
	if deliver("evt_4", "customer.subscription.updated", `{"id":"sub_1","status":"active","cancel_at_period_end":true}`) != 200 {
		t.Fatal("subscription.updated failed")
	}
	if plan, _, _, cancelling := state(); plan != "active" || !cancelling {
		t.Fatalf("cancellation at period end not recorded: %s %v", plan, cancelling)
	}
	if deliver("evt_5", "customer.subscription.deleted", `{"id":"sub_1","status":"canceled"}`) != 200 {
		t.Fatal("subscription.deleted failed")
	}
	if plan, days, _, _ = state(); plan != "canceled" || days < 32.9 {
		t.Fatalf("cancel must not cut off a period that was paid for: %s %.2f", plan, days)
	}
	// An invoice for an order we cannot find is retried by Stripe, not recorded as handled.
	if deliver("evt_6", "invoice.paid", `{"customer":"cus_9","subscription":"sub_unknown","lines":{"data":[{"period":{"end":`+fmt.Sprint(periodEnd)+`}}]}}`) != 500 {
		t.Fatal("payment for an unknown order was silently accepted")
	}
	var recorded int
	db.QueryRow("SELECT count(*) FROM portal_stripe_events WHERE id='evt_6'").Scan(&recorded)
	if recorded != 0 {
		t.Fatal("failed event recorded as processed")
	}
	// The same invoice resolved through subscription metadata (event arrived before checkout.session.completed).
	if _, e := db.Exec("UPDATE portal_orders SET stripe_subscription_id=NULL,plan_status='trialing' WHERE id=$1", order); e != nil {
		t.Fatal(e)
	}
	meta := `{"customer":"cus_1","subscription":"sub_2","subscription_details":{"metadata":{"order":"` + order + `"}},"lines":{"data":[{"period":{"end":` + fmt.Sprint(periodEnd) + `}}]}}`
	if deliver("evt_7", "invoice.paid", meta) != 200 {
		t.Fatal("invoice with order metadata failed")
	}
	if plan, _, sub, _ := state(); plan != "active" || sub != "sub_2" {
		t.Fatalf("metadata fallback did not link the order: %s %s", plan, sub)
	}
}
