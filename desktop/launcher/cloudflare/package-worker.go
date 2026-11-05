package cloudflare

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"slices"
	"strings"
)

type PackageWorker struct {
	Module WorkerModule
	Assets map[string][]byte
}

func LoadPackageWorker(directory, role string) (PackageWorker, error) {
	var payload PackageWorker
	if !slices.Contains([]string{"api", "customer", "management", "bootstrap", "bridge"}, role) {
		return payload, errors.New("Invalid Worker role")
	}
	manifest, err := VerifyDeploymentPackage(directory)
	if err != nil {
		return payload, err
	}
	return loadPackageWorker(directory, role, manifest)
}

func loadPackageWorker(directory, role string, manifest *DeploymentPackage) (PackageWorker, error) {
	var payload PackageWorker
	root, err := os.OpenRoot(directory)
	if err != nil {
		return payload, err
	}
	defer root.Close()
	var total int64
	read := func(name string) ([]byte, error) {
		expected, exists := manifest.Files[name]
		if !exists {
			return nil, errors.New("File is not in the deployment manifest")
		}
		total += expected.Bytes
		if total > 256<<20 {
			return nil, errors.New("Worker package exceeds memory limit")
		}
		file, err := root.Open(name)
		if err != nil {
			return nil, err
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil {
			return nil, err
		}
		if !info.Mode().IsRegular() {
			return nil, errors.New("Package file is not regular")
		}
		data, err := io.ReadAll(io.LimitReader(file, expected.Bytes+1))
		if err != nil {
			return nil, err
		}
		digest := sha256.Sum256(data)
		if int64(len(data)) != expected.Bytes || hex.EncodeToString(digest[:]) != expected.SHA256 {
			return nil, fmt.Errorf("Package changed while loading: %s", name)
		}
		return data, nil
	}
	worker := manifest.Workers[role]
	if worker.Entry == "" {
		return payload, errors.New("Worker is absent from the package")
	}
	entry, err := read(worker.Entry)
	if err != nil {
		return payload, err
	}
	payload.Module = WorkerModule{Name: path.Base(worker.Entry), Content: entry}
	if worker.Assets != "" {
		payload.Assets = make(map[string][]byte)
		for name := range manifest.Files {
			if strings.HasPrefix(name, worker.Assets+"/") {
				content, err := read(name)
				if err != nil {
					return PackageWorker{}, err
				}
				payload.Assets[strings.TrimPrefix(name, worker.Assets+"/")] = content
			}
		}
		if len(payload.Assets) == 0 {
			return PackageWorker{}, errors.New("Site package contains no assets")
		}
	}
	return payload, nil
}

// Metadata is installation-specific. The entrypoint always comes from the
// verified package. Package authenticity must be established by the caller.
func (c *Client) PublishPackageWorkerFromJournal(ctx context.Context, directory, packageDirectory, account, role string,
	metadata json.RawMessage) (ProvisionState, error) {
	payload, err := LoadPackageWorker(packageDirectory, role)
	if err != nil {
		return ProvisionState{}, err
	}
	var config map[string]json.RawMessage
	if json.Unmarshal(metadata, &config) != nil || config == nil {
		return ProvisionState{}, errors.New("Invalid Worker metadata")
	}
	config["main_module"], _ = json.Marshal(payload.Module.Name)
	encoded, err := json.Marshal(config)
	if err != nil {
		return ProvisionState{}, err
	}
	return c.PublishWorkerFromJournal(ctx, directory, account, role, encoded, []WorkerModule{payload.Module}, payload.Assets)
}
