package platform

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"
)

func TestMediaBackupEncryptionAndChecksums(t *testing.T) {
	s := &Server{Key: bytes.Repeat([]byte{6}, 32)}
	files := map[string][]byte{"uploads/test.webp": []byte("test-image")}
	encrypted, hash, e := s.sealMedia("backup", files)
	if e != nil {
		t.Fatal(e)
	}
	if bytes.Contains(encrypted, []byte("test-image")) {
		t.Fatal("plaintext image stored")
	}
	raw, e := Open(s.Key, encrypted, "backup:media")
	if e != nil {
		t.Fatal(e)
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != hash {
		t.Fatal("archive checksum mismatch")
	}
	var result struct {
		Files     map[string][]byte `json:"files"`
		Checksums map[string]string `json:"checksums"`
	}
	if json.Unmarshal(raw, &result) != nil || !bytes.Equal(result.Files["uploads/test.webp"], files["uploads/test.webp"]) {
		t.Fatal("image roundtrip failed")
	}
	sum = sha256.Sum256(files["uploads/test.webp"])
	if result.Checksums["uploads/test.webp"] != hex.EncodeToString(sum[:]) {
		t.Fatal("file checksum missing")
	}
	if _, e = Open(s.Key, encrypted, "another:media"); e == nil {
		t.Fatal("backup identity not enforced")
	}
}
