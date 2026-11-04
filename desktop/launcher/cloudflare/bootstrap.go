package cloudflare

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"slices"
)

var subdomainPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)
var installTokenPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

// BootstrapAndCleanupFromJournal sends credentials only to the installation's
// authenticated bridge. A server receipt permits safe recovery of a lost response.
func (c *Client) BootstrapAndCleanupFromJournal(ctx context.Context, directory, account, token string, business json.RawMessage) (ProvisionState, error) {
	return withJournal(directory, account, false, func(state ProvisionState, save func(ProvisionState) error) (ProvisionState, error) {
		if !state.BootstrapCompleted {
			if err := c.confirmBootstrap(ctx, state, token, business); err != nil {
				return state, err
			}
			next := state
			next.BootstrapCompleted = true
			if err := save(next); err != nil {
				return state, err
			}
			state = next
		}
		return c.cleanupBootstrap(ctx, state, save)
	})
}

func (c *Client) confirmBootstrap(ctx context.Context, state ProvisionState, token string, business json.RawMessage) error {
	if !accountID.MatchString(state.Account) || !resourceName.MatchString(state.Name+"-bridge") || !installTokenPattern.MatchString(token) ||
		!json.Valid(business) || len(business) > 8192 || state.Pending != "" || state.WorkerPending != nil || state.CleanupPending != "" {
		return errors.New("Invalid bootstrap request")
	}
	for _, role := range []string{"bootstrap", "bridge"} {
		tag := state.Workers[role]
		if tag == "" || state.TemporaryDeleted[role] {
			return errors.New("Bootstrap resources are unavailable")
		}
		tags, exists, err := c.workerTags(ctx, state.Account, state.Name+"-"+role)
		if err != nil {
			return err
		}
		if !exists || !slices.Contains(tags, tag) {
			return errors.New("Bootstrap resource ownership could not be verified")
		}
	}
	var domain struct {
		Subdomain string `json:"subdomain"`
	}
	if _, err := c.request(ctx, http.MethodGet, "/accounts/"+state.Account+"/workers/subdomain", nil, &domain); err != nil {
		return err
	}
	if !subdomainPattern.MatchString(domain.Subdomain) {
		return errors.New("Cloudflare workers.dev address is unavailable")
	}
	address := "https://" + state.Name + "-bridge." + domain.Subdomain + ".workers.dev/initialize"
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, address, bytes.NewReader(business))
	if err != nil {
		return errors.New("Invalid bootstrap address")
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("x-install-token", token)
	response, err := c.http.Do(request)
	if err != nil {
		return errors.New("Bootstrap response was lost. Resume installation to verify the result")
	}
	defer response.Body.Close()
	var receipt struct {
		OK           bool   `json:"ok"`
		Installation string `json:"installation"`
	}
	if (response.StatusCode != 200 && response.StatusCode != 201) ||
		json.NewDecoder(io.LimitReader(response.Body, 8192)).Decode(&receipt) != nil || !receipt.OK || receipt.Installation != state.Name {
		return errors.New("Bootstrap completion could not be verified")
	}
	return nil
}
