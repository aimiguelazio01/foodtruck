package cloudflare

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
)

type WorkerUploadIntent struct {
	Role   string `json:"role"`
	Tag    string `json:"tag"`
	Digest string `json:"digest"`
}

func workerDigest(metadata json.RawMessage, modules []WorkerModule, assets map[string][]byte) (string, error) {
	var config map[string]json.RawMessage
	if err := json.Unmarshal(metadata, &config); err != nil {
		return "", err
	}
	delete(config, "tags")
	moduleHashes := make(map[string]string, len(modules))
	for _, module := range modules {
		if _, exists := moduleHashes[module.Name]; exists {
			return "", errors.New("Duplicate Worker module")
		}
		digest := sha256.Sum256(module.Content)
		moduleHashes[module.Name] = hex.EncodeToString(digest[:])
	}
	assetHashes := make(map[string]string, len(assets))
	for name, data := range assets {
		digest := sha256.Sum256(data)
		assetHashes[name] = hex.EncodeToString(digest[:])
	}
	encoded, err := json.Marshal(struct {
		Config  map[string]json.RawMessage
		Modules map[string]string
		Assets  map[string]string
	}{config, moduleHashes, assetHashes})
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:]), nil
}

func (c *Client) workerTags(ctx context.Context, account, worker string) ([]string, bool, error) {
	var settings struct {
		Tags []string `json:"tags"`
	}
	_, err := c.request(ctx, http.MethodGet, "/accounts/"+account+"/workers/scripts/"+worker+"/script-settings", nil, &settings)
	var failure *APIError
	if errors.As(err, &failure) && failure.Status == 404 {
		return nil, false, nil
	}
	return settings.Tags, err == nil, err
}

// PublishNewWorker creates a worker for this installation. Keep the exclusive
// journal lock for the full call. Existing deployments require a separate upgrade flow.
func (c *Client) PublishNewWorker(ctx context.Context, state ProvisionState, role string, metadata json.RawMessage,
	modules []WorkerModule, assets map[string][]byte, save func(ProvisionState) error) (ProvisionState, error) {
	if !slices.Contains([]string{"api", "customer", "management", "bootstrap", "bridge"}, role) || !accountID.MatchString(state.Account) ||
		!resourceName.MatchString(state.Name+"-"+role) || state.Pending != "" || state.DatabaseID == "" || state.BucketName == "" {
		return state, errors.New("Invalid worker deployment state")
	}
	if state.CleanupPending != "" || state.TemporaryDeleted[role] {
		return state, errors.New("Worker publication is unavailable after temporary Worker cleanup")
	}
	var config map[string]json.RawMessage
	if json.Unmarshal(metadata, &config) != nil || config == nil {
		return state, errors.New("Invalid Worker metadata")
	}
	digest, err := workerDigest(metadata, modules, assets)
	if err != nil {
		return state, err
	}
	name := state.Name + "-" + role
	tags, exists, err := c.workerTags(ctx, state.Account, name)
	if err != nil {
		return state, err
	}
	finish := func(tag string) (ProvisionState, error) {
		next := state
		next.Workers = make(map[string]string, len(state.Workers)+1)
		for key, value := range state.Workers {
			next.Workers[key] = value
		}
		next.Workers[role] = tag
		next.WorkerDigests = make(map[string]string, len(state.WorkerDigests)+1)
		for key, value := range state.WorkerDigests {
			next.WorkerDigests[key] = value
		}
		next.WorkerDigests[role] = digest
		next.WorkerPending = nil
		if err := save(next); err != nil {
			return state, err
		}
		return next, nil
	}
	if tag := state.Workers[role]; tag != "" {
		if !exists || !slices.Contains(tags, tag) {
			return state, errors.New("Recorded Worker is missing or no longer belongs to this installation")
		}
		if state.WorkerDigests[role] == digest && state.WorkerPending == nil {
			return state, nil
		}
		if (role != "bootstrap" && role != "bridge") || state.BootstrapCompleted {
			return state, errors.New("Worker package changed. Use the upgrade workflow")
		}
		if pending := state.WorkerPending; pending != nil && (pending.Role != role || pending.Tag != tag || pending.Digest != digest) {
			return state, errors.New("Pending temporary Worker update requires the same package")
		}
		config["tags"], _ = json.Marshal([]string{tag})
		encoded, err := json.Marshal(config)
		if err != nil {
			return state, err
		}
		next := state
		next.WorkerPending = &WorkerUploadIntent{Role: role, Tag: tag, Digest: digest}
		if err := save(next); err != nil {
			return state, err
		}
		state = next
		// Re-uploading the same owned temporary Worker is safe after a lost acknowledgement.
		if err := c.UploadWorker(ctx, state.Account, name, encoded, modules); err != nil {
			return state, err
		}
		return finish(tag)
	}
	if pending := state.WorkerPending; pending != nil {
		if pending.Role == role && pending.Digest == digest && pending.Tag != "" && exists && slices.Contains(tags, pending.Tag) {
			return finish(pending.Tag)
		}
		return state, errors.New("Pending Worker upload could not be verified")
	}
	if exists {
		return state, errors.New("Worker name already in use")
	}
	var entropy [16]byte
	if _, err := rand.Read(entropy[:]); err != nil {
		return state, err
	}
	tag := "foodtruck-" + hex.EncodeToString(entropy[:])
	config["tags"], _ = json.Marshal([]string{tag})
	encoded, err := json.Marshal(config)
	if err != nil {
		return state, err
	}
	next := state
	next.WorkerPending = &WorkerUploadIntent{Role: role, Tag: tag, Digest: digest}
	if err := save(next); err != nil {
		return state, err
	}
	state = next
	if role == "api" || role == "bootstrap" || role == "bridge" {
		err = c.UploadWorker(ctx, state.Account, name, encoded, modules)
	} else {
		err = c.UploadSiteWorker(ctx, state.Account, name, encoded, modules, assets)
	}
	if err != nil {
		return state, err
	}
	return finish(tag)
}
