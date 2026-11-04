package cloudflare

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// ProvisionFromJournal stores the provisioning state in a directory dedicated
// to this installation. The journal must stay on a local filesystem.
func ProvisionFromJournal(ctx context.Context, client *Client, directory, account string) (ProvisionState, error) {
	return provisionFromJournal(ctx, client, directory, account)
}

func provisionFromJournal(ctx context.Context, client provisioningAPI, directory, account string) (ProvisionState, error) {
	return withJournal(directory, account, true, func(state ProvisionState, save func(ProvisionState) error) (ProvisionState, error) {
		return Provision(ctx, client, state, save)
	})
}

// PublishWorkerFromJournal shares the provisioning lock and atomic journal writes.
func (c *Client) PublishWorkerFromJournal(ctx context.Context, directory, account, role string,
	metadata json.RawMessage, modules []WorkerModule, assets map[string][]byte) (ProvisionState, error) {
	return withJournal(directory, account, false, func(state ProvisionState, save func(ProvisionState) error) (ProvisionState, error) {
		return c.PublishNewWorker(ctx, state, role, metadata, modules, assets, save)
	})
}

func withJournal(directory, account string, create bool, run func(ProvisionState, func(ProvisionState) error) (ProvisionState, error)) (ProvisionState, error) {
	if directory == "" || !accountID.MatchString(account) {
		return ProvisionState{}, errors.New("Invalid deployment directory or Cloudflare account")
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		return ProvisionState{}, err
	}
	lockPath := filepath.Join(directory, "provision.lock")
	// An exclusive lock directory is portable. After a hard crash, it is left
	// in place so another process cannot silently resume a possibly active job.
	if err := os.Mkdir(lockPath, 0700); err != nil {
		if errors.Is(err, os.ErrExist) {
			return ProvisionState{}, errors.New("Deployment is already running or was interrupted. Verify no installer is running before recovering the lock")
		}
		return ProvisionState{}, err
	}
	defer os.Remove(lockPath)

	path := filepath.Join(directory, "provision.json")
	state, err := readJournal(path)
	if create && errors.Is(err, os.ErrNotExist) {
		state, err = NewProvisionState(account)
		if err == nil {
			err = writeJournal(path, state)
		}
	}
	if err != nil {
		return ProvisionState{}, err
	}
	if state.Account != account {
		return ProvisionState{}, errors.New("This deployment belongs to another Cloudflare account")
	}
	return run(state, func(next ProvisionState) error { return writeJournal(path, next) })
}

func readJournal(path string) (ProvisionState, error) {
	var state ProvisionState
	file, err := os.Open(path)
	if err != nil {
		return state, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 4097))
	if err != nil {
		return state, err
	}
	if len(data) > 4096 {
		return state, errors.New("Deployment journal exceeds its size limit")
	}
	if err := json.Unmarshal(data, &state); err != nil {
		return state, fmt.Errorf("Invalid deployment journal: %w", err)
	}
	return state, nil
}

func writeJournal(path string, state ProvisionState) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".provision-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	writeErr := json.NewEncoder(file).Encode(state)
	if writeErr == nil {
		writeErr = file.Sync()
	}
	if err := errors.Join(writeErr, file.Close()); err != nil {
		return err
	}
	return os.Rename(file.Name(), path)
}
