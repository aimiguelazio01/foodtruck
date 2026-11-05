package cloudflare

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestRestoredSchemaMatchesSignedHistory(t *testing.T) {
	hash := strings.Repeat("a", 64)
	schema := DatabaseSchema{Minimum: 1, Maximum: 1, Migrations: []MigrationSpec{{Name: "001_initial", SHA256: hash}}}
	cases := []struct {
		name, rows string
		valid      bool
	}{
		{"matching", fmt.Sprintf(`[{"sequence":1,"name":"001_initial","sha256":%q}]`, hash), true},
		{"missing", `[]`, false},
		{"gap", fmt.Sprintf(`[{"sequence":2,"name":"001_initial","sha256":%q}]`, hash), false},
		{"modified", `[{"sequence":1,"name":"001_initial","sha256":"changed"}]`, false},
		{"renamed", fmt.Sprintf(`[{"sequence":1,"name":"001_other","sha256":%q}]`, hash), false},
		{"newer", fmt.Sprintf(`[{"sequence":1,"name":"001_initial","sha256":%q},{"sequence":2,"name":"002_next","sha256":%q}]`, hash, hash), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := New("token")
			c.http.Transport = transport(func(r *http.Request) (*http.Response, error) {
				if r.Method != "POST" || !strings.Contains(r.URL.Path, "copy-db/query") {
					t.Fatal("unexpected request")
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"success":true,"result":[{"success":true,"results":` + tc.rows + `}]}`))}, nil
			})
			e := c.verifyRestoredSchema(context.Background(), strings.Repeat("b", 32), "copy-db", schema)
			if (e == nil) != tc.valid {
				t.Fatal("schema compatibility result incorrect", e)
			}
		})
	}
	schema.Minimum = 0
	if validateSchemaContract(schema) == nil {
		t.Fatal("missing compatibility range accepted")
	}
	schema.Minimum = 1
	schema.Migrations = append(schema.Migrations, schema.Migrations[0])
	if validateSchemaContract(schema) == nil {
		t.Fatal("duplicate migration accepted")
	}
}
