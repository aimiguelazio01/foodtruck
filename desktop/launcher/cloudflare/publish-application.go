package cloudflare

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"net/http"
)

type ApplicationAddresses struct {
	Customer   string `json:"customer"`
	Management string `json:"management"`
}

type ApplicationPublishOptions struct {
	BackupToken             string
	Progress                func(string) error
	SubscriptionURL         string
	SubscriptionToken       string
	MailAPIKey              string
	MailFrom                string
	SiteDomain              *SiteDomain
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
	return c.publishVerifiedApplication(ctx, directory, packageDirectory, account, options, manifest)
}

func (c *Client) PublishLicensedApplication(ctx context.Context, directory, packageDirectory, account string,
	license []byte, key ed25519.PublicKey, imagesApproved bool) (ApplicationAddresses, error) {
	if _, err := VerifyLicense(license, key, account); err != nil {
		return ApplicationAddresses{}, err
	}
	manifest, err := VerifySignedDeploymentPackage(packageDirectory, key)
	if err != nil {
		return ApplicationAddresses{}, err
	}
	return c.publishVerifiedApplication(ctx, directory, packageDirectory, account, ApplicationPublishOptions{ImagesApproved: imagesApproved}, manifest)
}

func (c *Client) publishVerifiedApplication(ctx context.Context, directory, packageDirectory, account string,
	options ApplicationPublishOptions, manifest *DeploymentPackage) (ApplicationAddresses, error) {
	var addresses ApplicationAddresses
	if manifest.Status != "release" && !options.AllowIntegrationPreview {
		return addresses, errors.New("This package is an integration preview and is not approved for production deployment")
	}
	payloads := make(map[string]PackageWorker)
	for _, role := range []string{"api", "customer", "management"} {
		payload, err := loadPackageWorker(packageDirectory, role, manifest)
		if err != nil {
			return addresses, err
		}
		payloads[role] = payload
	}
	_, err := withJournal(directory, account, false, func(state ProvisionState, save func(ProvisionState) error) (ProvisionState, error) {
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
			if options.SiteDomain != nil {
				if role == "management" {
					return "https://" + options.SiteDomain.managementHost()
				}
				return "https://" + options.SiteDomain.customerHost()
			}
			return "https://" + state.Name + "-" + role + "." + domain.Subdomain + ".workers.dev"
		}
		for _, role := range []string{"api", "customer", "management"} {
			if options.Progress != nil {
				if e := options.Progress("publish-" + role); e != nil {
					return state, e
				}
			}
			payload := payloads[role]
			bindings := []map[string]string{}
			if role == "api" {
				bindings = append(bindings,
					map[string]string{"name": "DB", "type": "d1", "id": state.DatabaseID},
					map[string]string{"name": "MEDIA", "type": "r2_bucket", "bucket_name": state.BucketName},
					map[string]string{"name": "MANAGEMENT_ORIGIN", "type": "plain_text", "text": origin("management")},
					map[string]string{"name": "CUSTOMER_ORIGIN", "type": "plain_text", "text": origin("customer")})
				if options.BackupToken != "" {
					bindings = append(bindings, map[string]string{"name": "BACKUP_TOKEN", "type": "secret_text", "text": options.BackupToken})
				}
				if options.SubscriptionURL != "" {
					bindings = append(bindings, map[string]string{"name": "SUBSCRIPTION_STATUS_URL", "type": "plain_text", "text": options.SubscriptionURL}, map[string]string{"name": "SUBSCRIPTION_TOKEN", "type": "secret_text", "text": options.SubscriptionToken})
				}
				if options.MailAPIKey != "" && options.MailFrom != "" {
					bindings = append(bindings, map[string]string{"name": "BREVO_API_KEY", "type": "secret_text", "text": options.MailAPIKey}, map[string]string{"name": "MAIL_FROM", "type": "plain_text", "text": options.MailFrom})
				}
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
			if role == "api" && state.WorkerPending == nil {
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
		if options.SiteDomain != nil {
			if options.Progress != nil {
				if e := options.Progress("attach-domain"); e != nil {
					return state, e
				}
			}
			var err error
			if state, err = c.attachSiteDomains(ctx, state, *options.SiteDomain, save); err != nil {
				return state, err
			}
		}
		if err := c.configureMaintenance(ctx, state); err != nil {
			return state, err
		}
		candidate := ApplicationAddresses{Customer: origin("customer"), Management: origin("management")}
		if options.Progress != nil {
			if e := options.Progress("verify-application"); e != nil {
				return state, e
			}
		}
		verify := func() error { return c.verifyApplication(ctx, candidate) }
		if options.SiteDomain != nil {
			verify = func() error { return c.verifyApplicationAt(ctx, candidate, "."+options.SiteDomain.Domain) }
		}
		if err := verifyWithRetry(ctx, options.SiteDomain != nil, verify); err != nil {
			return state, err
		}
		addresses = candidate
		return state, nil
	})
	return addresses, err
}
