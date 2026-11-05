package cloudflare

import (
	"context"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"time"
)

type InstallOptions struct {
	BackupToken       string
	Progress          func(string) error
	SubscriptionURL   string
	SubscriptionToken string
	MailAPIKey        string
	MailFrom          string
	SiteDomain        *SiteDomain
	Business          json.RawMessage
	License           []byte
	PublicKey         ed25519.PublicKey
	CostsApproved     bool
	ImagesApproved    bool
}

func (c *Client) InstallApplication(ctx context.Context, directory, packageDirectory, account string, options InstallOptions) (ApplicationAddresses, error) {
	return c.installApplication(ctx, directory, packageDirectory, account, options, false)
}

// InstallPilot handles a single simulated purchase in the marketplace's own
// account. The purchase identifier selects the same journal on repeated runs.
func (c *Client) InstallPilot(ctx context.Context, journalRoot, packageDirectory, account, purchase string, options InstallOptions) (ApplicationAddresses, error) {
	license, err := VerifyLicense(options.License, options.PublicKey, account)
	if err != nil {
		return ApplicationAddresses{}, err
	}
	if journalRoot == "" || purchase == "" || license.OrderID != purchase {
		return ApplicationAddresses{}, errors.New("Pilot purchase does not match the license")
	}
	digest := sha256.Sum256([]byte(account + "\n" + purchase))
	return c.installApplication(ctx, filepath.Join(journalRoot, hex.EncodeToString(digest[:])), packageDirectory, account, options, true)
}

func (c *Client) installApplication(ctx context.Context, directory, packageDirectory, account string, options InstallOptions, pilot bool) (ApplicationAddresses, error) {
	var empty ApplicationAddresses
	if !options.CostsApproved {
		return empty, errors.New("Approve the Cloudflare resource costs before continuing")
	}
	if !json.Valid(options.Business) || len(options.Business) > 8192 {
		return empty, errors.New("Invalid business configuration")
	}
	if _, err := VerifyLicense(options.License, options.PublicKey, account); err != nil {
		return empty, err
	}
	if options.Progress != nil {
		if err := options.Progress("verify-package"); err != nil {
			return empty, err
		}
	}
	manifest, err := VerifySignedDeploymentPackage(packageDirectory, options.PublicKey)
	if err != nil {
		return empty, err
	}
	if manifest.Status != "release" && !(pilot && manifest.Status == "integration-preview") {
		return empty, errors.New("This package is not approved for production deployment")
	}
	setup := make(map[string]PackageWorker, 2)
	for _, role := range []string{"bootstrap", "bridge"} {
		worker, err := loadPackageWorker(packageDirectory, role, manifest)
		if err != nil {
			return empty, err
		}
		setup[role] = worker
	}
	var domain struct {
		Subdomain string `json:"subdomain"`
	}
	if _, err := c.request(ctx, http.MethodGet, "/accounts/"+account+"/workers/subdomain", nil, &domain); err != nil {
		return empty, err
	}
	if !subdomainPattern.MatchString(domain.Subdomain) {
		return empty, errors.New("Configure workers.dev before installing")
	}
	_, err = withJournal(directory, account, true, func(state ProvisionState, save func(ProvisionState) error) (ProvisionState, error) {
		var err error
		if options.Progress != nil {
			if e := options.Progress("provision-storage"); e != nil {
				return state, e
			}
		}
		state, err = Provision(ctx, c, state, save)
		if err != nil {
			return state, fmt.Errorf("provision: %w", err)
		}
		if state.BootstrapCompleted {
			return c.cleanupBootstrap(ctx, state, save)
		}
		expiresAt, parseExpiry := time.Parse(time.RFC3339, state.BootstrapExpires)
		if state.BootstrapExpires == "" || (parseExpiry == nil && !time.Now().Before(expiresAt) && state.WorkerPending == nil) {
			next := state
			next.BootstrapExpires = time.Now().UTC().Add(30 * time.Minute).Format(time.RFC3339)
			if err := save(next); err != nil {
				return state, err
			}
			state = next
		}
		expires, err := time.Parse(time.RFC3339, state.BootstrapExpires)
		if err != nil || !time.Now().Before(expires) {
			return state, errors.New("Setup window expired. Temporary Workers require recovery before restarting")
		}
		mac := hmac.New(sha256.New, []byte(c.token))
		_, _ = mac.Write([]byte("foodtruck-bootstrap-v1\n" + state.Account + "\n" + state.Name + "\n" + state.BootstrapExpires))
		token := hex.EncodeToString(mac.Sum(nil))
		for _, role := range []string{"bootstrap", "bridge"} {
			if state.WorkerPending != nil && state.WorkerPending.Role != role && state.Workers[role] != "" {
				// This earlier Worker had its address configured before the later upload began.
				continue
			}
			worker := setup[role]
			bindings := []map[string]string{
				{"name": "INSTALL_TOKEN", "type": "secret_text", "text": token},
				{"name": "INSTALL_TOKEN_EXPIRES_AT", "type": "plain_text", "text": state.BootstrapExpires},
			}
			if role == "bootstrap" {
				bindings = append(bindings, map[string]string{"name": "DB", "type": "d1", "id": state.DatabaseID},
					map[string]string{"name": "BOOTSTRAP_ID", "type": "plain_text", "text": state.Name})
			} else {
				bindings = append(bindings, map[string]string{"name": "FOODTRUCK_SETUP", "type": "service", "service": state.Name + "-bootstrap"})
			}
			metadata, err := json.Marshal(map[string]any{"main_module": worker.Module.Name, "compatibility_date": "2026-11-03", "bindings": bindings})
			if err != nil {
				return state, err
			}
			state, err = c.PublishNewWorker(ctx, state, role, metadata, []WorkerModule{worker.Module}, nil, save)
			if err != nil {
				return state, fmt.Errorf("setup Worker: %w", err)
			}
			if _, err := c.configureWorkerAddress(ctx, state, role, role == "bridge"); err != nil {
				return state, err
			}
		}
		if options.Progress != nil {
			if e := options.Progress("configure-business"); e != nil {
				return state, e
			}
		}
		return c.bootstrapAndCleanup(ctx, state, token, options.Business, save)
	})
	if err != nil {
		return empty, err
	}
	return c.publishVerifiedApplication(ctx, directory, packageDirectory, account, ApplicationPublishOptions{
		ImagesApproved: options.ImagesApproved, AllowIntegrationPreview: pilot, SubscriptionURL: options.SubscriptionURL, SubscriptionToken: options.SubscriptionToken, MailAPIKey: options.MailAPIKey, MailFrom: options.MailFrom, SiteDomain: options.SiteDomain, Progress: options.Progress, BackupToken: options.BackupToken,
	}, manifest)
}
