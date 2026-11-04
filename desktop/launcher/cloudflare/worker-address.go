package cloudflare

import (
	"context"
	"errors"
	"net/http"
	"slices"
)

type WorkerAddress struct {
	URL     string `json:"url,omitempty"`
	Enabled bool   `json:"enabled"`
}

type subdomainSettings struct {
	Enabled  bool `json:"enabled"`
	Previews bool `json:"previews_enabled"`
}

// ConfigureWorkerAddressFromJournal reconciles workers.dev exposure after an
// upload. Repeating the call is safe even if a previous response was lost.
func (c *Client) ConfigureWorkerAddressFromJournal(ctx context.Context, directory, account, role string, enabled bool) (WorkerAddress, error) {
	var address WorkerAddress
	_, err := withJournal(directory, account, false, func(state ProvisionState, save func(ProvisionState) error) (ProvisionState, error) {
		var err error
		address, err = c.configureWorkerAddress(ctx, state, role, enabled)
		return state, err
	})
	return address, err
}

func (c *Client) configureWorkerAddress(ctx context.Context, state ProvisionState, role string, enabled bool) (WorkerAddress, error) {
	var address WorkerAddress
	account := state.Account
	if !slices.Contains([]string{"api", "bootstrap", "bridge", "customer", "management"}, role) ||
		!resourceName.MatchString(state.Name+"-"+role) || state.WorkerPending != nil || state.Pending != "" || state.CleanupPending != "" || state.TemporaryDeleted[role] {
		return address, errors.New("Worker address is not ready for configuration")
	}
	if enabled && (role == "api" || role == "bootstrap" || role == "bridge" && state.BootstrapCompleted ||
		(role == "customer" || role == "management") && !state.BootstrapCompleted) {
		return address, errors.New("Worker cannot be made public at this installation stage")
	}
	tag := state.Workers[role]
	if tag == "" {
		return address, errors.New("Worker ownership is not recorded")
	}
	name := state.Name + "-" + role
	tags, exists, err := c.workerTags(ctx, state.Account, name)
	if err != nil {
		return address, err
	}
	if !exists || !slices.Contains(tags, tag) {
		return address, errors.New("Worker ownership could not be verified")
	}
	var domain struct {
		Subdomain string `json:"subdomain"`
	}
	if enabled {
		if _, err := c.request(ctx, http.MethodGet, "/accounts/"+account+"/workers/subdomain", nil, &domain); err != nil {
			return address, err
		}
		if !subdomainPattern.MatchString(domain.Subdomain) {
			return address, errors.New("Configure the account workers.dev subdomain in Cloudflare before continuing")
		}
	}
	endpoint := "/accounts/" + account + "/workers/scripts/" + name + "/subdomain"
	var settings subdomainSettings
	if _, err := c.request(ctx, http.MethodGet, endpoint, nil, &settings); err != nil {
		return address, err
	}
	if settings.Enabled != enabled || settings.Previews {
		if _, err := c.request(ctx, http.MethodPost, endpoint, subdomainSettings{Enabled: enabled, Previews: false}, nil); err != nil {
			return address, err
		}
		if _, err := c.request(ctx, http.MethodGet, endpoint, nil, &settings); err != nil {
			return address, err
		}
	}
	if settings.Enabled != enabled || settings.Previews {
		return address, errors.New("Worker address configuration was not confirmed")
	}
	address.Enabled = enabled
	if enabled {
		address.URL = "https://" + name + "." + domain.Subdomain + ".workers.dev"
	}
	return address, nil
}
