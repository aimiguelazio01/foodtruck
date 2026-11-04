package cloudflare

import (
	"context"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"
)

func TestWorkerMultipart(t *testing.T) {
	client := New("test-token")
	account := strings.Repeat("a", 32)
	metadata := []byte(`{"main_module":"entry.mjs"}`)
	calls := 0
	client.http.Transport = transport(func(req *http.Request) (*http.Response, error) {
		calls++
		if req.Method != http.MethodPut || req.URL.Path != "/client/v4/accounts/"+account+"/workers/scripts/foodtruck-api" {
			t.Fatal("incorrect upload endpoint")
		}
		_, params, err := mime.ParseMediaType(req.Header.Get("Content-Type"))
		if err != nil {
			t.Fatal(err)
		}
		reader := multipart.NewReader(req.Body, params["boundary"])
		for _, expected := range []struct{ name, kind string }{
			{"metadata", "application/json"}, {"entry.mjs", "application/javascript+module"}, {"chunks/codec.wasm", "application/wasm"},
		} {
			part, err := reader.NextPart()
			if err != nil {
				t.Fatal(err)
			}
			if part.FormName() != expected.name || part.Header.Get("Content-Type") != expected.kind {
				t.Fatal("invalid upload part")
			}
		}
		if _, err := reader.NextPart(); err != io.EOF {
			t.Fatal("unexpected extra upload part")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"success":true,"result":{}}`))}, nil
	})
	ctx := context.Background()
	if err := client.UploadWorker(ctx, account, "foodtruck-api", metadata, []WorkerModule{{"entry.mjs", []byte("export default {}")}, {"chunks/codec.wasm", []byte{0}}}); err != nil {
		t.Fatal(err)
	}
	if err := client.UploadWorker(ctx, account, "foodtruck-api", metadata, []WorkerModule{{"../entry.mjs", nil}}); err == nil {
		t.Fatal("unsafe module name accepted")
	}
	if calls != 1 {
		t.Fatalf("unexpected API calls: %d", calls)
	}
}
