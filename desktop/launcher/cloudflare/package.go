package cloudflare

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"strings"
)

type DeploymentPackage struct {
	Schema      DatabaseSchema `json:"schema"`
	Format      int            `json:"format"`
	Application string         `json:"application"`
	Version     string         `json:"version"`
	Status      string         `json:"status"`
	Workers     map[string]struct {
		Entry      string `json:"entry"`
		Assets     string `json:"assets"`
		Visibility string `json:"visibility"`
		Temporary  bool   `json:"temporary,omitempty"`
	} `json:"workers"`
	Files map[string]struct {
		Bytes  int64  `json:"bytes"`
		SHA256 string `json:"sha256"`
	} `json:"files"`
}

// VerifyDeploymentPackage checks inventory and integrity. Trust in the manifest
// itself must come from the signed installer or an independently verified signature.
func VerifyDeploymentPackage(directory string) (*DeploymentPackage, error) {
	return verifyDeploymentPackage(directory, nil)
}

func VerifySignedDeploymentPackage(directory string, key ed25519.PublicKey) (*DeploymentPackage, error) {
	if len(key) != ed25519.PublicKeySize {
		return nil, errors.New("Missing vendor public key")
	}
	return verifyDeploymentPackage(directory, key)
}

func verifyDeploymentPackage(directory string, key ed25519.PublicKey) (*DeploymentPackage, error) {
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	manifest, err := root.Open("manifest.json")
	if err != nil {
		return nil, err
	}
	data, err := io.ReadAll(io.LimitReader(manifest, (4<<20)+1))
	manifest.Close()
	if err != nil {
		return nil, err
	}
	var result DeploymentPackage
	if key != nil {
		file, err := root.Open("manifest.signature")
		if err != nil {
			return nil, errors.New("Signed deployment manifest is missing")
		}
		encoded, err := io.ReadAll(io.LimitReader(file, 129))
		file.Close()
		if err != nil {
			return nil, err
		}
		signature, err := base64.RawURLEncoding.Strict().DecodeString(strings.TrimSpace(string(encoded)))
		if len(encoded) > 128 || err != nil || !ed25519.Verify(key, DeploymentSigningMessage(data), signature) {
			return nil, errors.New("Invalid deployment manifest signature")
		}
	}
	if len(data) > 4<<20 || json.Unmarshal(data, &result) != nil || result.Format != 1 ||
		result.Application != licenseApplication || result.Version == "" || len(result.Files) == 0 {
		return nil, errors.New("Invalid Food Truck Live deployment manifest")
	}
	for _, role := range []string{"api", "customer", "management"} {
		worker := result.Workers[role]
		if _, ok := result.Files[worker.Entry]; !ok || !strings.HasPrefix(worker.Entry, role+"/") {
			return nil, fmt.Errorf("Missing %s Worker entrypoint", role)
		}
		if role == "api" && (worker.Visibility != "private" || worker.Assets != "") ||
			role != "api" && (worker.Visibility != "public" || worker.Assets != role+"/assets") {
			return nil, fmt.Errorf("Invalid %s Worker configuration", role)
		}
	}
	for _, role := range []string{"bootstrap", "bridge"} {
		worker, exists := result.Workers[role]
		if !exists {
			continue
		}
		expectedVisibility := "private"
		if role == "bridge" {
			expectedVisibility = "public"
		}
		if _, ok := result.Files[worker.Entry]; !ok || !strings.HasPrefix(worker.Entry, role+"/") ||
			!worker.Temporary || worker.Visibility != expectedVisibility || worker.Assets != "" {
			return nil, fmt.Errorf("Invalid temporary %s Worker", role)
		}
	}
	seen := 0
	err = fs.WalkDir(root.FS(), ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || name == "manifest.json" || name == "manifest.signature" {
			return nil
		}
		expected, listed := result.Files[name]
		if !listed || !entry.Type().IsRegular() || expected.Bytes < 0 || expected.Bytes > 32<<20 || strings.ContainsAny(name, `\:`) {
			return fmt.Errorf("Unexpected package file: %s", name)
		}
		file, err := root.Open(name)
		if err != nil {
			return err
		}
		defer file.Close()
		digest := sha256.New()
		count, err := io.Copy(digest, io.LimitReader(file, expected.Bytes+1))
		if err != nil {
			return err
		}
		if count != expected.Bytes || hex.EncodeToString(digest.Sum(nil)) != expected.SHA256 {
			return fmt.Errorf("Package checksum mismatch: %s", name)
		}
		seen++
		return nil
	})
	if err != nil {
		return nil, err
	}
	if seen != len(result.Files) {
		return nil, errors.New("Deployment package is missing files")
	}
	return &result, nil
}

func DeploymentSigningMessage(manifest []byte) []byte {
	return append([]byte("foodtruck-deployment-v1\n"), manifest...)
}
