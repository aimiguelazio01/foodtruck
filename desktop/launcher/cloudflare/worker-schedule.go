package cloudflare

import (
	"context"
	"errors"
	"net/http"
	"slices"
)

type workerSchedule struct {
	Cron string `json:"cron"`
}

func (c *Client) configureMaintenance(ctx context.Context, state ProvisionState) error {
	name := state.Name + "-api"
	tag := state.Workers["api"]
	if !accountID.MatchString(state.Account) || !resourceName.MatchString(name) || tag == "" || !state.BootstrapCompleted {
		return errors.New("API is not ready for scheduled maintenance")
	}
	tags, exists, err := c.workerTags(ctx, state.Account, name)
	if err != nil {
		return err
	}
	if !exists || !slices.Contains(tags, tag) {
		return errors.New("API ownership could not be verified")
	}
	endpoint := "/accounts/" + state.Account + "/workers/scripts/" + name + "/schedules"
	var current struct {
		Schedules []workerSchedule `json:"schedules"`
	}
	if _, err := c.request(ctx, http.MethodGet, endpoint, nil, &current); err != nil {
		return err
	}
	if len(current.Schedules) == 0 {
		if _, err := c.request(ctx, http.MethodPut, endpoint, []workerSchedule{{Cron: "* * * * *"}}, nil); err != nil {
			return err
		}
		if _, err := c.request(ctx, http.MethodGet, endpoint, nil, &current); err != nil {
			return err
		}
	}
	if len(current.Schedules) != 1 || current.Schedules[0].Cron != "* * * * *" {
		return errors.New("API has an unexpected maintenance schedule. Review it in Cloudflare before continuing")
	}
	return nil
}
