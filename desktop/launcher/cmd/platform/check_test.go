package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"database/sql"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type routes map[string]string // "host/path?query" -> JSON body; missing = 404

func (r routes) RoundTrip(request *http.Request) (*http.Response, error) {
	key := request.URL.Host + request.URL.Path
	if request.URL.RawQuery != "" {
		key += "?" + request.URL.RawQuery
	}
	recorder := httptest.NewRecorder()
	if body, ok := r[key]; ok {
		recorder.WriteString(body)
	} else if body, ok := r[request.URL.Host+request.URL.Path+"*"]; ok { // any query
		recorder.WriteString(body)
	} else {
		recorder.WriteHeader(404)
		recorder.WriteString(`{"success":false}`)
	}
	response := recorder.Result()
	response.Body = io.NopCloser(bytes.NewReader(recorder.Body.Bytes()))
	return response, nil
}

const account = "0123456789abcdef0123456789abcdef"

func healthy() (map[string]string, routes) {
	_, private, _ := ed25519.GenerateKey(nil)
	env := map[string]string{
		"PLATFORM_ENCRYPTION_KEY":     base64.RawURLEncoding.EncodeToString(make([]byte, 32)),
		"PLATFORM_ADMIN_KEY":          strings.Repeat("a", 40),
		"PLATFORM_SIGNING_KEY":        base64.RawURLEncoding.EncodeToString(private),
		"PLATFORM_ORIGIN":             "https://instalar.example.pt",
		"PLATFORM_PUBLIC_HOST":        "instalar.example.pt",
		"PLATFORM_HOSTING_APPROVED":   "true",
		"PLATFORM_DATABASE_URL":       "postgres://x",
		"PLATFORM_PACKAGE_DIRECTORY":  "/does/not/exist",
		"PLATFORM_CLOUDFLARE_ACCOUNT": account,
		"PLATFORM_CLOUDFLARE_TOKEN":   "cloudflare-token-value-123",
		"PLATFORM_SITE_DOMAIN":        "example.pt",
		"PLATFORM_SITE_ZONE_ID":       "zone1",
		"PLATFORM_BREVO_API_KEY":      "xkeysib-secret",
		"PLATFORM_MAIL_FROM":          "Food Truck Live <nao-responder@example.pt>",
		"STRIPE_SECRET_KEY":           "sk_test_secret",
		"STRIPE_WEBHOOK_SECRET":       "whsec_abc",
		"STRIPE_PRICE_ID":             "price_123",
	}
	cf := "api.cloudflare.com/client/v4"
	r := routes{
		cf + "/user/tokens/verify":                        `{"success":true,"result":{"status":"active"}}`,
		cf + "/accounts/" + account + "/subscriptions":    `{"success":true,"result":[{"state":"Paid","rate_plan":{"id":"workers_paid"}}]}`,
		cf + "/accounts/" + account + "/d1/database*":     `{"success":true,"result":[]}`,
		cf + "/accounts/" + account + "/r2/buckets*":      `{"success":true,"result":{"buckets":[]}}`,
		cf + "/accounts/" + account + "/workers/scripts":  `{"success":true,"result":[]}`,
		cf + "/accounts/" + account + "/workers/domains*": `{"success":true,"result":[]}`,
		cf + "/zones/zone1":                               `{"success":true,"result":{"name":"example.pt","status":"active","account":{"id":"` + account + `"}}}`,
		"api.brevo.com/v3/account":                        `{"email":"op@example.pt"}`,
		"api.brevo.com/v3/senders":                        `{"senders":[{"email":"nao-responder@example.pt","active":true}]}`,
		"api.brevo.com/v3/senders/domains":                `{"domains":[{"domain_name":"example.pt","authenticated":true}]}`,
		"api.stripe.com/v1/prices/price_123":              `{"active":true,"currency":"eur","type":"recurring","unit_amount":1500,"recurring":{"interval":"month"}}`,
		"api.stripe.com/v1/webhook_endpoints?limit=100":   `{"data":[{"url":"https://instalar.example.pt/stripe/webhook","status":"enabled","enabled_events":["checkout.session.completed","invoice.paid","invoice.payment_failed","customer.subscription.updated","customer.subscription.deleted"]}]}`,
		"instalar.example.pt/":                            `<html></html>`,
	}
	return env, r
}

func runWith(env map[string]string, r routes) (int, string) {
	var out bytes.Buffer
	c := &checker{env: func(k string) string { return env[k] }, transport: r, out: &out,
		openDB: func(string) (*sql.DB, error) { return nil, errors.New("no database in unit tests") }}
	return c.run(context.Background()), out.String()
}

func TestCheckReportsEveryServiceWithoutPrintingSecrets(t *testing.T) {
	env, r := healthy()
	failures, out := runWith(env, r)
	for _, want := range []string{"✔ Cloudflare: token ativo", "Workers Paid ativo", "zona example.pt ativa", "✔ Brevo: remetente nao-responder@example.pt ativo",
		"domínio example.pt autenticado", "modo teste; preço 15.00 EUR por month", "com os 5 eventos", "responde em HTTPS"} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in:\n%s", want, out)
		}
	}
	// Only the database (no server here) and the package (missing folder) fail.
	if failures != 2 || !strings.Contains(out, "✘ PostgreSQL") || !strings.Contains(out, "✘ Pacote") {
		t.Fatalf("unexpected failures (%d):\n%s", failures, out)
	}
	for _, secret := range []string{"cloudflare-token-value-123", "xkeysib-secret", "sk_test_secret", "whsec_abc", env["PLATFORM_SIGNING_KEY"], env["PLATFORM_ADMIN_KEY"]} {
		if strings.Contains(out, secret) {
			t.Fatalf("secret printed: %q", secret)
		}
	}
}

func TestCheckAcceptsAFreeAccountWithoutADomain(t *testing.T) {
	env, r := healthy()
	env["PLATFORM_SITE_DOMAIN"], env["PLATFORM_SITE_ZONE_ID"] = "", ""
	failures, out := runWith(env, r)
	if !strings.Contains(out, "! Cloudflare: sem domínio próprio") || strings.Contains(out, "✘ Cloudflare") {
		t.Fatalf("free mode not accepted:\n%s", out)
	}
	r["api.stripe.com/v1/webhook_endpoints?limit=100"] = `{"data":[]}`
	failures, out = runWith(env, r)
	if !strings.Contains(out, "! Stripe: sem webhook no painel") {
		t.Fatalf("free mode webhook not accepted:\n%s", out)
	}
	if failures != 2 { // database and package only, as in the healthy case
		t.Fatalf("unexpected failures (%d):\n%s", failures, out)
	}
}

func TestCheckExplainsTheCommonMistakes(t *testing.T) {
	cases := map[string]func(map[string]string, routes){
		"token inválido": func(_ map[string]string, r routes) { delete(r, "api.cloudflare.com/client/v4/user/tokens/verify") },
		"Workers Paid": func(_ map[string]string, r routes) {
			r["api.cloudflare.com/client/v4/accounts/"+account+"/subscriptions"] = `{"success":true,"result":[]}`
		},
		"ainda não está ativa": func(_ map[string]string, r routes) {
			r["api.cloudflare.com/client/v4/zones/zone1"] = `{"success":true,"result":{"name":"example.pt","status":"pending","account":{"id":"` + account + `"}}}`
		},
		"pertence a outro.pt": func(_ map[string]string, r routes) {
			r["api.cloudflare.com/client/v4/zones/zone1"] = `{"success":true,"result":{"name":"outro.pt","status":"active","account":{"id":"` + account + `"}}}`
		},
		"não está autenticado": func(_ map[string]string, r routes) {
			r["api.brevo.com/v3/senders/domains"] = `{"domains":[{"domain_name":"example.pt","authenticated":false}]}`
		},
		"não existe ou não está ativo": func(_ map[string]string, r routes) { r["api.brevo.com/v3/senders"] = `{"senders":[]}` },
		"faltam eventos no webhook: invoice.paid": func(_ map[string]string, r routes) {
			r["api.stripe.com/v1/webhook_endpoints?limit=100"] = `{"data":[{"url":"https://instalar.example.pt/stripe/webhook","status":"enabled","enabled_events":["checkout.session.completed","invoice.payment_failed","customer.subscription.updated","customer.subscription.deleted"]}]}`
		},
		"não existe webhook para": func(_ map[string]string, r routes) {
			r["api.stripe.com/v1/webhook_endpoints?limit=100"] = `{"data":[]}`
		},
		"mesmo modo":                       func(_ map[string]string, r routes) { delete(r, "api.stripe.com/v1/prices/price_123") },
		"responde HTTP 404":                func(_ map[string]string, r routes) { delete(r, "instalar.example.pt/") },
		"PLATFORM_ORIGIN tem de ser https": func(e map[string]string, _ routes) { e["PLATFORM_ORIGIN"] = "http://instalar.example.pt" },
		"PLATFORM_SIGNING_KEY em falta": func(e map[string]string, _ routes) {
			e["PLATFORM_SIGNING_KEY"] = base64.RawURLEncoding.EncodeToString(make([]byte, 64))
		},
		"PRODUÇÃO": func(e map[string]string, _ routes) { e["STRIPE_SECRET_KEY"] = "sk_live_x" },
	}
	for want, change := range cases {
		env, r := healthy()
		change(env, r)
		_, out := runWith(env, r)
		if !strings.Contains(out, want) {
			t.Errorf("%q not reported:\n%s", want, out)
		}
	}
}
