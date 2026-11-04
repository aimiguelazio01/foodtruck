package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestInvalidRequestsDoNotEchoSecrets(t *testing.T) {
	for _, input := range []string{`{"action":"unknown","token":"private-token"}`, `invalid private-token`, strings.Repeat("x", 65537)} {
		var output bytes.Buffer
		if err := run(strings.NewReader(input+"\n"), &output); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(output.String(), `"error"`) || strings.Contains(output.String(), "private-token") {
			t.Fatalf("unsafe or invalid response: %s", output.String())
		}
	}
}
