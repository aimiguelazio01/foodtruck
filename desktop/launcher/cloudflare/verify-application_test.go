package cloudflare

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestApplicationVerificationRejectsUnconfiguredOrDemoSites(t *testing.T) {
	for _, body := range []string{`{}`, `{"configured":false,"demo":false,"readOnly":false}`, `{"configured":true,"demo":true,"readOnly":false}`, `{"configured":true,"demo":false,"readOnly":true}`} {
		client := New("private-token")
		client.http.Transport = transport(func(req *http.Request) (*http.Response, error) {
			if req.Header.Get("Authorization") != "" {
				t.Fatal("API token leaked")
			}
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
		})
		if err := client.verifyApplication(context.Background(), ApplicationAddresses{Customer: "https://site.account.workers.dev", Management: "https://manage.account.workers.dev"}); err == nil {
			t.Fatalf("unexpected application status accepted: %s", body)
		}
	}
}

func TestDemonstrationVerificationAcceptsOnlyDemoSitesAndOrdinaryOnesOnlyNonDemo(t *testing.T) {
	serve := func(body string) *Client {
		client := New("private-token")
		client.http.Transport = transport(func(req *http.Request) (*http.Response, error) {
			header := http.Header{"Content-Type": []string{"text/html"}}
			if strings.HasSuffix(req.URL.Path, "/status") {
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
			}
			return &http.Response{StatusCode: 200, Header: header, Body: io.NopCloser(strings.NewReader("<html></html>"))}, nil
		})
		return client
	}
	addresses := ApplicationAddresses{Customer: "https://site.account.workers.dev", Management: "https://manage.account.workers.dev"}
	demo, ordinary := `{"configured":true,"demo":true,"readOnly":false}`, `{"configured":true,"demo":false,"readOnly":false}`
	if err := serve(demo).verifyApplicationAs(context.Background(), addresses, ".workers.dev", true); err != nil {
		t.Fatalf("demonstration rejected: %v", err)
	}
	if err := serve(ordinary).verifyApplicationAs(context.Background(), addresses, ".workers.dev", true); err == nil {
		t.Fatal("an ordinary site was accepted as the demonstration")
	}
	if err := serve(demo).verifyApplicationAs(context.Background(), addresses, ".workers.dev", false); err == nil {
		t.Fatal("a demonstration was accepted as an ordinary customer site")
	}
}
