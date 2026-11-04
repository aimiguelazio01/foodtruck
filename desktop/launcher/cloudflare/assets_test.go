package cloudflare

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"
)

func TestUploadSiteWorkerTransfersAssetsBeforeScript(t *testing.T) {
	client := New("account-token")
	digest := sha256.Sum256([]byte("aGk=txt"))
	hash := fmt.Sprintf("%x", digest[:16])
	calls := 0
	client.http.Transport = transport(func(req *http.Request) (*http.Response, error) {
		calls++
		var response string
		switch calls {
		case 1:
			var body struct{ Manifest map[string]assetEntry }
			if !strings.HasSuffix(req.URL.Path, "/assets-upload-session") || json.NewDecoder(req.Body).Decode(&body) != nil ||
				body.Manifest["/hello.txt"] != (assetEntry{Hash: hash, Size: 2}) {
				t.Fatal("invalid session request")
			}
			response = fmt.Sprintf(`{"success":true,"result":{"jwt":"asset-token","buckets":[[%q]]}}`, hash)
		case 2, 3:
			_, params, err := mime.ParseMediaType(req.Header.Get("Content-Type"))
			if err != nil {
				t.Fatal(err)
			}
			part, err := multipart.NewReader(req.Body, params["boundary"]).NextPart()
			if err != nil {
				t.Fatal(err)
			}
			body, err := io.ReadAll(part)
			if err != nil {
				t.Fatal(err)
			}
			if calls == 2 {
				if req.Header.Get("Authorization") != "Bearer asset-token" || req.URL.Query().Get("base64") != "true" || part.FormName() != hash || string(body) != "aGk=" {
					t.Fatal("invalid asset upload")
				}
				response = `{"success":true,"result":{"jwt":"completion-token"}}`
			} else {
				if req.Header.Get("Authorization") != "Bearer account-token" || req.Method != http.MethodPut || !strings.Contains(string(body), `"jwt":"completion-token"`) {
					t.Fatal("missing asset completion on Worker upload")
				}
				response = `{"success":true,"result":{}}`
			}
		default:
			t.Fatal("unexpected request")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(response))}, nil
	})
	err := client.UploadSiteWorker(context.Background(), strings.Repeat("a", 32), "foodtruck-site", []byte(`{"main_module":"entry.mjs"}`),
		[]WorkerModule{{Name: "entry.mjs", Content: []byte("export default {}")}}, map[string][]byte{"hello.txt": []byte("hi")})
	if err != nil || calls != 3 {
		t.Fatalf("upload failed after %d requests: %v", calls, err)
	}
}
