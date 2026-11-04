package cloudflare

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
)

const licenseApplication = "food-truck-live"

type License struct {
	Version int    `json:"version"`
	Product string `json:"product"`
	Account string `json:"account"`
	OrderID string `json:"orderId"`
}

// VerifyLicense verifies the exact signed payload before interpreting claims.
// The desktop caller must supply the vendor public key compiled into the release.
func VerifyLicense(document []byte, key ed25519.PublicKey, account string) (License, error) {
	var claims License
	if len(document) > 8192 || len(key) != ed25519.PublicKeySize || !accountID.MatchString(account) {
		return claims, errors.New("Invalid license or account")
	}
	var envelope struct {
		Payload   string `json:"payload"`
		Signature string `json:"signature"`
	}
	if json.Unmarshal(document, &envelope) != nil {
		return claims, errors.New("Invalid license file")
	}
	payload, payloadErr := base64.RawURLEncoding.Strict().DecodeString(envelope.Payload)
	signature, signatureErr := base64.RawURLEncoding.Strict().DecodeString(envelope.Signature)
	if payloadErr != nil || signatureErr != nil || !ed25519.Verify(key, payload, signature) {
		return claims, errors.New("Invalid license signature")
	}
	if json.Unmarshal(payload, &claims) != nil || claims.Version != 1 || claims.Product != licenseApplication || claims.OrderID == "" {
		return License{}, errors.New("License is not valid for Food Truck Live")
	}
	if claims.Account != account {
		return License{}, errors.New("License belongs to a different Cloudflare account")
	}
	return claims, nil
}
