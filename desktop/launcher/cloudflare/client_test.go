package cloudflare

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

type transport func(*http.Request) (*http.Response, error)

func (fn transport) RoundTrip(req *http.Request) (*http.Response, error) { return fn(req) }

func TestAccountPagination(t *testing.T) {
	client := New("test-token")
	requests := 0
	client.http.Transport = transport(func(req *http.Request) (*http.Response, error) {
		requests++
		if req.URL.Host != "api.cloudflare.com" || req.Header.Get("Authorization") != "Bearer test-token" {
			t.Fatal("incorrect Cloudflare host or authorization")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(
			`{"success":true,"result":[{"name":"Account"}],"result_info":{"total_pages":2}}`))}, nil
	})
	accounts, err := client.Accounts(context.Background())
	if err != nil || len(accounts) != 2 || requests != 2 {
		t.Fatalf("accounts=%v requests=%d error=%v", accounts, requests, err)
	}
}

func TestCreateNeverRetriesAnAmbiguousMutation(t *testing.T) {
	client := New("test-token")
	requests := 0
	client.http.Transport = transport(func(req *http.Request) (*http.Response, error) {
		requests++
		return nil, errors.New("response lost: test-token")
	})
	_, err := client.CreateDatabase(context.Background(), strings.Repeat("a", 32), "foodtruck-test")
	var failure *APIError
	if !errors.As(err, &failure) || !failure.OutcomeUnknown || requests != 1 || strings.Contains(err.Error(), "test-token") {
		t.Fatalf("unexpected result: requests=%d error=%v", requests, err)
	}
}
