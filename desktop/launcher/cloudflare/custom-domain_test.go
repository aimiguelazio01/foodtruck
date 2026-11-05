package cloudflare

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestValidSlug(t *testing.T) {
	for _, slug := range []string{"bella-pizza", "truck42", "o-meu-camiao"} {
		if !ValidSlug(slug) {
			t.Errorf("%q should be accepted", slug)
		}
	}
	for _, slug := range []string{"", "ab", "-bella", "bella-", "Bella", "bella_pizza", "bella pizza", "bella--pizza", "bella.pt", "admin", "www", "instalar",
		"bella-gestao", "foodtruck-0123", strings.Repeat("a", 41), "café", "../x"} {
		if ValidSlug(slug) {
			t.Errorf("%q should be refused", slug)
		}
	}
}

func TestAttachSiteDomainsBindsBothHostsAndNeverTakesOverAnotherCustomersAddress(t *testing.T) {
	state, err := NewProvisionState(strings.Repeat("a", 32))
	if err != nil {
		t.Fatal(err)
	}
	domain := SiteDomain{Domain: "example.pt", Zone: strings.Repeat("b", 32), Slug: "bella"}
	bound := map[string]string{} // hostname -> service, standing in for Cloudflare
	puts := 0
	client := New("test-token")
	client.http.Transport = transport(func(req *http.Request) (*http.Response, error) {
		respond := func(result any) (*http.Response, error) {
			encoded, _ := json.Marshal(map[string]any{"success": true, "result": result})
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(encoded)))}, nil
		}
		if !strings.HasSuffix(req.URL.Path, "/workers/domains") {
			t.Fatalf("unexpected request %s %s", req.Method, req.URL)
		}
		if req.Method == http.MethodGet {
			host := req.URL.Query().Get("hostname")
			if service, ok := bound[host]; ok {
				return respond([]workerDomain{{ID: "d", Hostname: host, Service: service}})
			}
			return respond([]workerDomain{})
		}
		if req.Method != http.MethodPut {
			t.Fatalf("unexpected method %s", req.Method)
		}
		var body struct {
			Hostname string `json:"hostname"`
			Service  string `json:"service"`
			Zone     string `json:"zone_id"`
			Enabled  bool   `json:"enabled"`
		}
		decoder := json.NewDecoder(req.Body)
		decoder.DisallowUnknownFields() // documented inputs only; "environment" was removed
		if err := decoder.Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Zone != domain.Zone || !body.Enabled || body.Hostname == "" || body.Service == "" {
			t.Fatalf("unexpected binding %+v", body)
		}
		puts++
		bound[body.Hostname] = body.Service
		return respond(map[string]any{"id": "d", "hostname": body.Hostname, "service": body.Service, "zone_id": body.Zone,
			"zone_name": "example.pt", "enabled": true, "previews_enabled": false, "cert_id": "c"})
	})
	saved := 0
	save := func(ProvisionState) error { saved++; return nil }
	ctx := context.Background()

	next, err := client.attachSiteDomains(ctx, state, domain, save)
	if err != nil || puts != 2 || saved != 1 {
		t.Fatalf("attach: err=%v puts=%d saved=%d", err, puts, saved)
	}
	if bound["bella.example.pt"] != state.Name+"-customer" || bound["bella-gestao.example.pt"] != state.Name+"-management" {
		t.Fatalf("wrong bindings %+v", bound)
	}
	if len(next.Domains) != 2 {
		t.Fatalf("hostnames were not journaled: %+v", next.Domains)
	}
	if _, err := client.attachSiteDomains(ctx, next, domain, save); err != nil || puts != 2 {
		t.Fatalf("repeat should change nothing: err=%v puts=%d", err, puts)
	}

	other, _ := NewProvisionState(strings.Repeat("a", 32))
	if _, err := client.attachSiteDomains(ctx, other, domain, save); err == nil || puts != 2 {
		t.Fatalf("another installation took over an address: err=%v puts=%d", err, puts)
	}
	if _, err := client.attachSiteDomains(ctx, state, SiteDomain{Domain: "example.pt", Zone: "short", Slug: "bella"}, save); err == nil {
		t.Fatal("invalid zone accepted")
	}
	if _, err := client.attachSiteDomains(ctx, state, SiteDomain{Domain: "example.pt", Zone: domain.Zone, Slug: "admin"}, save); err == nil {
		t.Fatal("reserved slug accepted")
	}
}

func TestVerifyWithRetryWaitsOnlyWhenAsked(t *testing.T) {
	domainVerifyDelay = 0
	calls := 0
	failTwice := func() error {
		calls++
		if calls < 3 {
			return context.DeadlineExceeded
		}
		return nil
	}
	if err := verifyWithRetry(context.Background(), false, failTwice); err == nil || calls != 1 {
		t.Fatalf("no-wait mode retried: err=%v calls=%d", err, calls)
	}
	calls = 0
	if err := verifyWithRetry(context.Background(), true, failTwice); err != nil || calls != 3 {
		t.Fatalf("wait mode did not recover: err=%v calls=%d", err, calls)
	}
}
