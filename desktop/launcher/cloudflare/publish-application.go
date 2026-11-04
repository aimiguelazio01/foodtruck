package cloudflare

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
)

type ApplicationAddresses struct {
	Customer   string `json:"customer"`
	Management string `json:"management"`
}

type ApplicationPublishOptions struct {
	AllowIntegrationPreview bool
	ImagesApproved          bool
}

// PublishApplicationFromJournal is the post-bootstrap deployment stage.
// Authorization, license verification and billing approval precede this call.
func (c *Client) PublishApplicationFromJournal(ctx context.Context, directory, packageDirectory, account string,
	options ApplicationPublishOptions) (ApplicationAddresses, error) {
	var addresses ApplicationAddresses
	manifest, err := VerifyDeploymentPackage(packageDirectory)
	if err != nil {
		return addresses, err
	}
	if manifest.Status != "release" && !options.AllowIntegrationPreview {
		return addresses, errors.New("This package is an integration preview and is not approved for production deployment")
	}
	payloads := make(map[string]PackageWorker)
	for _, role := range []string{"api", "customer", "management"} {
		payload, err := LoadPackageWorker(packageDirectory, role)
		if err != nil {
			return addresses, err
		}
		payloads[role] = payload
	}
	_, err = withJournal(directory, account, false, func(state ProvisionState, save func(ProvisionState) error) (ProvisionState, error) {
		if !state.BootstrapCompleted || !state.TemporaryDeleted["bridge"] || !state.TemporaryDeleted["bootstrap"] {
			return state, errors.New("Complete initial configuration and temporary Worker cleanup before publishing the application")
		}
		var domain struct {
			Subdomain string `json:"subdomain"`
		}
		if _, err := c.request(ctx, http.MethodGet, "/accounts/"+account+"/workers/subdomain", nil, &domain); err != nil {
			return state, err
		}
		if !subdomainPattern.MatchString(domain.Subdomain) {
			return state, errors.New("Cloudflare workers.dev address is unavailable")
		}
		origin := func(role string) string {
			return "https://" + state.Name + "-" + role + "." + domain.Subdomain + ".workers.dev"
		}
		for _, role := range []string{"api", "customer", "management"} {
			payload := payloads[role]
			bindings := []map[string]string{}
			if role == "api" {
				bindings = append(bindings,
					map[string]string{"name": "DB", "type": "d1", "id": state.DatabaseID},
					map[string]string{"name": "MEDIA", "type": "r2_bucket", "bucket_name": state.BucketName},
					map[string]string{"name": "MANAGEMENT_ORIGIN", "type": "plain_text", "text": origin("management")},
					map[string]string{"name": "CUSTOMER_ORIGIN", "type": "plain_text", "text": origin("customer")})
				if options.ImagesApproved {
					bindings = append(bindings, map[string]string{"name": "IMAGES", "type": "images"})
				}
			} else {
				bindings = append(bindings,
					map[string]string{"name": "ASSETS", "type": "assets"},
					map[string]string{"name": "FOODTRUCK_API", "type": "service", "service": state.Name + "-api"},
					map[string]string{"name": "WORKER_SELF_REFERENCE", "type": "service", "service": state.Name + "-" + role})
			}
			metadata, err := json.Marshal(map[string]any{"main_module": payload.Module.Name, "compatibility_date": "2026-11-03",
				"compatibility_flags": []string{"nodejs_compat", "global_fetch_strictly_public"}, "bindings": bindings})
			if err != nil {
				return state, err
			}
			state, err = c.PublishNewWorker(ctx, state, role, metadata, []WorkerModule{payload.Module}, payload.Assets, save)
			if err != nil {
				return state, err
			}
			if role == "api" {
				if _, err := c.configureWorkerAddress(ctx, state, role, false); err != nil {
					return state, err
				}
			}
		}
		for _, role := range []string{"customer", "management"} {
			if _, err := c.configureWorkerAddress(ctx, state, role, true); err != nil {
				return state, err
			}
		}
		if err := c.configureMaintenance(ctx, state); err != nil {
			return state, err
		}
		candidate := ApplicationAddresses{Customer: origin("customer"), Management: origin("management")}
		if err := c.verifyApplication(ctx, candidate); err != nil {
			return state, err
		}
		addresses = candidate
		return state, nil
	})
	return addresses, err
}
