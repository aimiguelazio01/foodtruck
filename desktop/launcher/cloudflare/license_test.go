package cloudflare

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

func TestVerifyLicense(t *testing.T) {
	public, private, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	account := strings.Repeat("a", 32)
	payload, _ := json.Marshal(License{Version: 1, Product: licenseApplication, Account: account, OrderID: "order-1"})
	document := func(signature []byte) []byte {
		data, _ := json.Marshal(map[string]string{"payload": base64.RawURLEncoding.EncodeToString(payload),
			"signature": base64.RawURLEncoding.EncodeToString(signature)})
		return data
	}
	signed := ed25519.Sign(private, payload)
	if claims, err := VerifyLicense(document(signed), public, account); err != nil || claims.OrderID != "order-1" {
		t.Fatalf("license verification failed: %+v %v", claims, err)
	}
	if _, err := VerifyLicense(document(signed), public, strings.Repeat("b", 32)); err == nil {
		t.Fatal("wrong account accepted")
	}
	signed[0] ^= 1
	if _, err := VerifyLicense(document(signed), public, account); err == nil {
		t.Fatal("tampered signature accepted")
	}
}
