package cloudflare

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestRestoredSessionResetTargetsOnlyCopy(t *testing.T) {
	c := New("token")
	partial := false
	c.http.Transport = transport(func(r *http.Request) (*http.Response, error) {
		if !strings.HasSuffix(r.URL.Path, "/copy-db/query") {
			t.Fatal("wrong database target")
		}
		var body struct {
			SQL string `json:"sql"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil || body.SQL != restoreSessionReset {
			t.Fatal("wrong session cleanup")
		}
		results := strings.Repeat(`{"success":true},`, 6) + `{"success":true}`
		if partial {
			results = `{"success":false}`
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"success":true,"result":[` + results + `]}`))}, nil
	})
	if e := c.clearRestoredSessions(context.Background(), strings.Repeat("a", 32), "copy-db"); e != nil {
		t.Fatal(e)
	}
	partial = true
	if e := c.clearRestoredSessions(context.Background(), strings.Repeat("a", 32), "copy-db"); e == nil {
		t.Fatal("incomplete cleanup accepted")
	}
}
