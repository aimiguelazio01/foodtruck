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
