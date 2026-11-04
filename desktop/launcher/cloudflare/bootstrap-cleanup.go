package cloudflare

import (
	"context"
	"errors"
	"net/http"
	"slices"
)

func (c *Client) CleanupBootstrapFromJournal(ctx context.Context, directory, account string) (ProvisionState, error) {
	return withJournal(directory, account, false, func(state ProvisionState, save func(ProvisionState) error) (ProvisionState, error) {
		return c.cleanupBootstrap(ctx, state, save)
	})
}

func (c *Client) cleanupBootstrap(ctx context.Context, state ProvisionState, save func(ProvisionState) error) (ProvisionState, error) {
	if !state.BootstrapCompleted || !accountID.MatchString(state.Account) || !resourceName.MatchString(state.Name+"-bootstrap") ||
		state.WorkerPending != nil || state.Pending != "" ||
		(state.CleanupPending != "" && state.CleanupPending != "bridge" && state.CleanupPending != "bootstrap") {
		return state, errors.New("Bootstrap is not ready for cleanup")
	}
	for _, role := range []string{"bridge", "bootstrap"} {
		if state.TemporaryDeleted[role] {
			continue
		}
		if state.CleanupPending != "" && state.CleanupPending != role {
			return state, errors.New("Temporary worker cleanup order is inconsistent")
		}
		tag := state.Workers[role]
		if tag == "" {
			return state, errors.New("Temporary Worker ownership is not recorded")
		}
		name := state.Name + "-" + role
		tags, exists, err := c.workerTags(ctx, state.Account, name)
		if err != nil {
			return state, err
		}
		if exists && !slices.Contains(tags, tag) {
			return state, errors.New("Temporary Worker no longer belongs to this installation")
		}
		if !exists && state.CleanupPending != role {
			return state, errors.New("Temporary Worker disappeared before cleanup")
		}
		if exists {
			next := state
			next.CleanupPending = role
			if err := save(next); err != nil {
				return state, err
			}
			state = next
			_, err := c.request(ctx, http.MethodDelete, "/accounts/"+state.Account+"/workers/scripts/"+name, nil, nil)
			if err != nil {
				return state, err
			}
		}
		next := state
		next.TemporaryDeleted = make(map[string]bool, len(state.TemporaryDeleted)+1)
		for key, value := range state.TemporaryDeleted {
			next.TemporaryDeleted[key] = value
		}
		next.TemporaryDeleted[role] = true
		next.CleanupPending = ""
		if err := save(next); err != nil {
			return state, err
		}
		state = next
	}
	return state, nil
}
