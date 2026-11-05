package cloudflare

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestHostingPreflightNeverMutates(t *testing.T) {
	cases := []struct{ name, subscriptions, failPath, code string }{
		{"paid", `[{"state":"Paid","rate_plan":{"id":"WORKERS_PAID"}}]`, "", ""},
		{"provisioned", `[{"state":"Provisioned","rate_plan":{"id":"workers_paid"}}]`, "", ""},
		{"free", `[]`, "", "WORKERS_PAID_REQUIRED"},
		{"cancelled", `[{"state":"Cancelled","rate_plan":{"id":"WORKERS_PAID"}}]`, "", "WORKERS_PAID_REQUIRED"},
		{"pending", `[{"state":"AwaitingPayment","rate_plan":{"id":"WORKERS_PAID"}}]`, "", "WORKERS_PAID_REQUIRED"},
		{"unrelated", `[{"state":"Paid","rate_plan":{"id":"R2_PAID"}}]`, "", "WORKERS_PAID_REQUIRED"},
		{"permission", `[]`, "subscriptions", "BILLING_ACCESS_REQUIRED"},
		{"r2", `[{"state":"Paid","rate_plan":{"id":"WORKERS_PAID"}}]`, "r2/buckets", "R2_UNAVAILABLE"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			client := New("token")
			client.http.Transport = transport(func(r *http.Request) (*http.Response, error) {
				if r.Method != "GET" {
					t.Fatal("preflight mutated resources")
				}
				if strings.Contains(r.URL.Path, tc.failPath) && tc.failPath != "" {
					return &http.Response{StatusCode: 403, Body: io.NopCloser(strings.NewReader(`{"success":false}`))}, nil
				}
				result := "[]"
				if strings.HasSuffix(r.URL.Path, "/subscriptions") {
					result = tc.subscriptions
				}
				if strings.Contains(r.URL.Path, "r2/buckets") {
					result = `{"buckets":[]}`
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"success":true,"result":` + result + `}`))}, nil
			})
			report, e := client.InspectHosting(context.Background(), strings.Repeat("a", 32))
			if tc.code == "" {
				if e != nil || !report.Paid || !report.D1 || !report.R2 || !report.Workers {
					t.Fatal("valid preflight refused", e)
				}
			} else {
				var failure *HostingError
				if !errors.As(e, &failure) || failure.Code != tc.code {
					t.Fatalf("expected %s, got %v", tc.code, e)
				}
			}
		})
	}
}
