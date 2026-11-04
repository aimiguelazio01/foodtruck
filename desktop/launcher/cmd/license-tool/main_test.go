package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"foodtruck.local/desktop/cloudflare"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSellerCanGenerateKeysAndIssueAnAccountLicense(t *testing.T) {
	dir := t.TempDir()
	private, public := filepath.Join(dir, "seller.pem"), filepath.Join(dir, "public.txt")
	if err := generate(private, public); err != nil {
		t.Fatal(err)
	}
	if err := generate(private, public); err == nil {
		t.Fatal("existing seller key was overwritten")
	}
	account := strings.Repeat("a", 32)
	license := filepath.Join(dir, "customer.license.json")
	if err := issue(private, account, "purchase-1", license); err != nil {
		t.Fatal(err)
	}
	keyData, err := os.ReadFile(public)
	if err != nil {
		t.Fatal(err)
	}
	key, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(string(keyData)))
	if err != nil {
		t.Fatal(err)
	}
	document, err := os.ReadFile(license)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := cloudflare.VerifyLicense(document, ed25519.PublicKey(key), account)
	if err != nil || claims.OrderID != "purchase-1" {
		t.Fatalf("issued license is invalid: %+v %v", claims, err)
	}
	if err := issue(private, account, "purchase-2", license); err == nil {
		t.Fatal("existing license was overwritten")
	}
	if err := issue(private, "invalid", "purchase-2", filepath.Join(dir, "invalid.json")); err == nil {
		t.Fatal("invalid account accepted")
	}
}
