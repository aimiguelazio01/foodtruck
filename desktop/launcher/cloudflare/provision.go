package cloudflare

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
)

// ProvisionState contains only resource identifiers. Store it separately from credentials.
type ProvisionState struct {
	Account            string              `json:"account"`
	Name               string              `json:"name"`
	DatabaseID         string              `json:"databaseId,omitempty"`
	BucketName         string              `json:"bucketName,omitempty"`
	Pending            string              `json:"pending,omitempty"`
	WorkerPending      *WorkerUploadIntent `json:"workerPending,omitempty"`
	Workers            map[string]string   `json:"workers,omitempty"`
	WorkerDigests      map[string]string   `json:"workerDigests,omitempty"`
	BootstrapCompleted bool                `json:"bootstrapCompleted,omitempty"`
	CleanupPending     string              `json:"cleanupPending,omitempty"`
	TemporaryDeleted   map[string]bool     `json:"temporaryDeleted,omitempty"`
}

func NewProvisionState(account string) (ProvisionState, error) {
	if !accountID.MatchString(account) {
		return ProvisionState{}, errors.New("Invalid Cloudflare account")
	}
	var entropy [16]byte
	if _, err := rand.Read(entropy[:]); err != nil {
		return ProvisionState{}, err
	}
	return ProvisionState{Account: account, Name: "foodtruck-" + hex.EncodeToString(entropy[:])}, nil
}

type provisioningAPI interface {
	FindDatabase(context.Context, string, string) (*Database, error)
	CreateDatabase(context.Context, string, string) (Database, error)
	CreateBucket(context.Context, string, string) (Bucket, error)
}

// Provision creates storage after deployment approval. The caller must hold an
// exclusive installation lock and save each state atomically before returning.
func Provision(ctx context.Context, client provisioningAPI, state ProvisionState, save func(ProvisionState) error) (ProvisionState, error) {
	if !accountID.MatchString(state.Account) || !resourceName.MatchString(state.Name) ||
		(state.BucketName != "" && state.BucketName != state.Name) || (state.DatabaseID == "" && state.BucketName != "") {
		return state, errors.New("Invalid Cloudflare deployment journal")
	}
	if state.Pending != "" {
		return state, fmt.Errorf("A previous %s creation has an uncertain outcome. Verify it in Cloudflare before continuing", state.Pending)
	}
	start := func(kind string) error {
		next := state
		next.Pending = kind
		if err := save(next); err != nil {
			return err
		}
		state = next
		return nil
	}
	finish := func(next ProvisionState) error {
		next.Pending = ""
		if err := save(next); err != nil {
			return err
		}
		state = next
		return nil
	}
	rejected := func(err error) error {
		var failure *APIError
		if errors.As(err, &failure) && !failure.OutcomeUnknown {
			return errors.Join(err, finish(state))
		}
		return err
	}
	if state.DatabaseID == "" {
		existing, err := client.FindDatabase(ctx, state.Account, state.Name)
		if err != nil {
			return state, err
		}
		if existing != nil {
			return state, errors.New("The database name is already in use")
		}
		if err := start("D1 database"); err != nil {
			return state, err
		}
		database, err := client.CreateDatabase(ctx, state.Account, state.Name)
		if err != nil {
			err = rejected(err)
			return state, err
		}
		next := state
		next.DatabaseID = database.ID
		if err := finish(next); err != nil {
			return state, err
		}
	}
	if state.BucketName == "" {
		if err := start("R2 bucket"); err != nil {
			return state, err
		}
		bucket, err := client.CreateBucket(ctx, state.Account, state.Name)
		if err != nil {
			err = rejected(err)
			return state, err
		}
		next := state
		next.BucketName = bucket.Name
		if err := finish(next); err != nil {
			return state, err
		}
	}
	return state, nil
}
