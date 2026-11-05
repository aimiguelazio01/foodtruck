package cloudflare

import (
	"context"
	"errors"
	"net/http"
	"slices"
)

type BootstrapDiagnostics struct {
	DatabaseResponds  bool                `json:"databaseResponds"`
	MigrationLedger   bool                `json:"migrationLedger"`
	MigrationsApplied int                 `json:"migrationsApplied"`
	InstallationReady bool                `json:"installationReady"`
	BindingNames      map[string][]string `json:"bindingNames"`
}

// DiagnoseBootstrap reads only schema progress and binding names. Secret binding
// values, account credentials and application data are never returned.
func (c *Client) DiagnoseBootstrap(ctx context.Context, directory, account string) (BootstrapDiagnostics, error) {
	var result BootstrapDiagnostics
	_, err := withJournal(directory, account, false, func(state ProvisionState, save func(ProvisionState) error) (ProvisionState, error) {
		result.BindingNames = make(map[string][]string)
		for _, role := range []string{"bootstrap", "bridge"} {
			name := state.Name + "-" + role
			if !resourceName.MatchString(name) || state.Workers[role] == "" {
				return state, errors.New("Setup Worker is not recorded")
			}
			tags, exists, err := c.workerTags(ctx, account, name)
			if err != nil {
				return state, err
			}
			if !exists || !slices.Contains(tags, state.Workers[role]) {
				return state, errors.New("Setup Worker ownership could not be verified")
			}
			var settings struct {
				Bindings []struct {
					Name string `json:"name"`
				} `json:"bindings"`
			}
			if _, err := c.request(ctx, http.MethodGet, "/accounts/"+account+"/workers/scripts/"+name+"/settings", nil, &settings); err != nil {
				return state, err
			}
			for _, binding := range settings.Bindings {
				result.BindingNames[role] = append(result.BindingNames[role], binding.Name)
			}
		}
		if state.DatabaseID == "" {
			return state, errors.New("Setup database is not recorded")
		}
		var queries []struct {
			Results []struct {
				Count int `json:"n"`
			} `json:"results"`
			Success bool `json:"success"`
		}
		query := func(sql string) (int, error) {
			queries = nil
			_, err := c.request(ctx, http.MethodPost, "/accounts/"+account+"/d1/database/"+state.DatabaseID+"/query", map[string]any{"sql": sql, "params": []any{}}, &queries)
			if err != nil {
				return 0, err
			}
			if len(queries) != 1 || !queries[0].Success || len(queries[0].Results) != 1 {
				return 0, errors.New("D1 diagnostic query failed")
			}
			return queries[0].Results[0].Count, nil
		}
		count, err := query("SELECT count(*) n FROM sqlite_schema WHERE type='table' AND name='foodtruck_schema_migrations'")
		if err != nil {
			return state, err
		}
		result.DatabaseResponds = true
		result.MigrationLedger = count == 1
		if result.MigrationLedger {
			result.MigrationsApplied, err = query("SELECT count(*) n FROM foodtruck_schema_migrations")
			if err != nil {
				return state, err
			}
		}
		count, err = query("SELECT count(*) n FROM sqlite_schema WHERE type='table' AND name='installation_state'")
		if err != nil {
			return state, err
		}
		if count == 1 {
			count, err = query("SELECT count(*) n FROM installation_state WHERE id=1")
			if err != nil {
				return state, err
			}
			result.InstallationReady = count == 1
		}
		return state, nil
	})
	return result, err
}
