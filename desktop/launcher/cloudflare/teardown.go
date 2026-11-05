package cloudflare

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"path/filepath"
	"slices"
	"strings"
)

// ErrStoragePending means everything except the media bucket has been removed and the bucket still
// holds objects that are expiring. Run Teardown again later; it resumes at the bucket.
var ErrStoragePending = errors.New("Media storage is still emptying; try again later")

const (
	tearDownDomains   = "domains-removed"
	tearDownWorkers   = "workers-removed"
	tearDownDatabase  = "database-removed"
	tearDownComplete  = "complete"
	mediaExpirySecond = 86400
)

// TeardownPilot removes every Cloudflare resource of one managed installation: its custom
// addresses, Workers, D1 database and R2 bucket. It is the destructive counterpart of InstallPilot
// and uses the same journal. Each resource is checked against the identity recorded at install time
// before it is deleted, so a name that now belongs to someone else is never touched. The caller must
// have taken a verified backup first. Repeating the call after a failure is safe.
func (c *Client) TeardownPilot(ctx context.Context, journalRoot, account, purchase string) (ProvisionState, error) {
	if journalRoot == "" || purchase == "" {
		return ProvisionState{}, errors.New("Teardown needs a journal and purchase")
	}
	digest := sha256.Sum256([]byte(account + "\n" + purchase))
	return withJournal(filepath.Join(journalRoot, hex.EncodeToString(digest[:])), account, false, func(state ProvisionState, save func(ProvisionState) error) (ProvisionState, error) {
		return c.teardown(ctx, state, save)
	})
}

func (c *Client) teardown(ctx context.Context, state ProvisionState, save func(ProvisionState) error) (ProvisionState, error) {
	if !accountID.MatchString(state.Account) || !resourceName.MatchString(state.Name) || state.WorkerPending != nil || state.Pending != "" {
		return state, errors.New("Installation is not in a state that can be removed")
	}
	advance := func(stage string) error {
		state.Teardown = stage
		return save(state)
	}
	if state.Teardown == tearDownComplete {
		return state, nil
	}
	if state.Teardown == "" {
		if err := c.removeSiteDomains(ctx, state); err != nil {
			return state, err
		}
		if err := advance(tearDownDomains); err != nil {
			return state, err
		}
	}
	if state.Teardown == tearDownDomains {
		// Sites first: they hold service bindings to the API.
		for _, role := range []string{"customer", "management", "api", "bridge", "bootstrap"} {
			if err := c.removeWorker(ctx, state, role); err != nil {
				return state, err
			}
		}
		if err := advance(tearDownWorkers); err != nil {
			return state, err
		}
	}
	if state.Teardown == tearDownWorkers {
		if err := c.removeDatabase(ctx, state); err != nil {
			return state, err
		}
		if err := advance(tearDownDatabase); err != nil {
			return state, err
		}
	}
	if state.Teardown == tearDownDatabase {
		if err := c.removeBucket(ctx, state); err != nil {
			return state, err
		}
		state.Domains = nil
		if err := advance(tearDownComplete); err != nil {
			return state, err
		}
	}
	return state, nil
}

func isStatus(err error, status int) bool {
	var failure *APIError
	return errors.As(err, &failure) && failure.Status == status
}

func (c *Client) removeSiteDomains(ctx context.Context, state ProvisionState) error {
	for _, host := range state.Domains {
		var found []workerDomain
		query := url.Values{"hostname": {host}}.Encode()
		if _, err := c.request(ctx, http.MethodGet, "/accounts/"+state.Account+"/workers/domains?"+query, nil, &found); err != nil {
			return err
		}
		for _, domain := range found {
			if domain.Hostname != host {
				continue
			}
			if !strings.HasPrefix(domain.Service, state.Name+"-") {
				return errors.New("A site address now belongs to another installation")
			}
			if _, err := c.request(ctx, http.MethodDelete, "/accounts/"+state.Account+"/workers/domains/"+url.PathEscape(domain.ID), nil, nil); err != nil && !isStatus(err, 404) {
				return err
			}
		}
	}
	return nil
}

func (c *Client) removeWorker(ctx context.Context, state ProvisionState, role string) error {
	tag := state.Workers[role]
	if tag == "" || state.TemporaryDeleted[role] {
		return nil // never published, or already cleaned up
	}
	name := state.Name + "-" + role
	tags, exists, err := c.workerTags(ctx, state.Account, name)
	if err != nil {
		return err
	}
	if !exists {
		return nil
	}
	if !slices.Contains(tags, tag) {
		return errors.New("A Worker no longer belongs to this installation")
	}
	_, err = c.request(ctx, http.MethodDelete, "/accounts/"+state.Account+"/workers/scripts/"+name, nil, nil)
	if err != nil && !isStatus(err, 404) {
		return err
	}
	return nil
}

func (c *Client) removeDatabase(ctx context.Context, state ProvisionState) error {
	if state.DatabaseID == "" {
		return nil
	}
	var database struct {
		Name string `json:"name"`
	}
	path := "/accounts/" + state.Account + "/d1/database/" + url.PathEscape(state.DatabaseID)
	if _, err := c.request(ctx, http.MethodGet, path, nil, &database); err != nil {
		if isStatus(err, 404) {
			return nil
		}
		return err
	}
	if database.Name != state.Name {
		return errors.New("The database no longer belongs to this installation")
	}
	if _, err := c.request(ctx, http.MethodDelete, path, nil, nil); err != nil && !isStatus(err, 404) {
		return err
	}
	return nil
}

// removeBucket expires every object (a bucket must be empty to be deleted) and then deletes it.
// The REST API has no bulk object delete, so a lifecycle rule empties the bucket within a day.
func (c *Client) removeBucket(ctx context.Context, state ProvisionState) error {
	if state.BucketName == "" {
		return nil
	}
	if state.BucketName != state.Name {
		return errors.New("Unexpected media bucket name")
	}
	base := "/accounts/" + state.Account + "/r2/buckets/" + url.PathEscape(state.BucketName)
	rule := map[string]any{"rules": []map[string]any{{
		"id": "expire-everything", "enabled": true, "conditions": map[string]string{"prefix": ""},
		"deleteObjectsTransition": map[string]any{"condition": map[string]any{"type": "Age", "maxAge": mediaExpirySecond}},
	}}}
	if _, err := c.request(ctx, http.MethodPut, base+"/lifecycle", rule, nil); err != nil {
		if isStatus(err, 404) {
			return nil // bucket already gone
		}
		return err
	}
	if _, err := c.request(ctx, http.MethodDelete, base, nil, nil); err != nil {
		if isStatus(err, 404) {
			return nil
		}
		if isStatus(err, 409) {
			return ErrStoragePending
		}
		return err
	}
	return nil
}
