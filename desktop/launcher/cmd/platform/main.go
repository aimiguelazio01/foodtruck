package main

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"foodtruck.local/desktop/cloudflare"
	"foodtruck.local/desktop/platform"
	_ "github.com/jackc/pgx/v5/stdlib"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func main() {
	if exit, handled := checkCommand(os.Args[1:]); handled {
		os.Exit(exit)
	}
	if exit, handled := demoInstallCommand(os.Args[1:]); handled {
		os.Exit(exit)
	}
	key, e := base64.RawURLEncoding.DecodeString(os.Getenv("PLATFORM_ENCRYPTION_KEY"))
	if e != nil || len(key) != 32 {
		log.Fatal("Configure PLATFORM_ENCRYPTION_KEY: 32 random bytes, base64url")
	}
	if len(os.Getenv("PLATFORM_ADMIN_KEY")) < 32 || os.Getenv("PLATFORM_ORIGIN") == "" {
		log.Fatal("Configure PLATFORM_ADMIN_KEY and PLATFORM_ORIGIN")
	}
	db, e := sql.Open("pgx", os.Getenv("PLATFORM_DATABASE_URL"))
	if e != nil {
		log.Fatal("PostgreSQL configuration failed")
	}
	defer db.Close()
	if _, e = db.Exec(platform.Schema); e != nil {
		log.Fatal("Platform schema initialization failed")
	}
	s := &platform.Server{PlatformAccount: os.Getenv("PLATFORM_CLOUDFLARE_ACCOUNT"), PlatformToken: os.Getenv("PLATFORM_CLOUDFLARE_TOKEN"), OAuth: platform.OAuthConfig{ClientID: os.Getenv("PLATFORM_OAUTH_CLIENT_ID"), ClientSecret: os.Getenv("PLATFORM_OAUTH_CLIENT_SECRET"), Scopes: os.Getenv("PLATFORM_OAUTH_SCOPES")}, DB: db, Key: key, AdminKey: os.Getenv("PLATFORM_ADMIN_KEY"), Origin: os.Getenv("PLATFORM_ORIGIN"), SiteDomain: os.Getenv("PLATFORM_SITE_DOMAIN"), SiteZone: os.Getenv("PLATFORM_SITE_ZONE_ID"), RetentionDays: envInt("PLATFORM_RETENTION_DAYS", 30), MaxInstallations: envInt("PLATFORM_MAX_INSTALLATIONS", 0), BrevoKey: os.Getenv("PLATFORM_BREVO_API_KEY"), MailFrom: os.Getenv("PLATFORM_MAIL_FROM"), StripeKey: os.Getenv("STRIPE_SECRET_KEY"), StripeSecret: os.Getenv("STRIPE_WEBHOOK_SECRET"), StripePrice: os.Getenv("STRIPE_PRICE_ID"), TrialDays: trialDays()}
	s.RestoreImages = func(ctx context.Context, job, id string, files map[string][]byte, state cloudflare.RestoreCopy, save func(cloudflare.RestoreCopy) error) (cloudflare.RestoreCopy, error) {
		account, token, customerHosted, e := s.JobCredentials(ctx, job)
		if e != nil {
			return state, e
		}
		if !customerHosted {
			account = os.Getenv("PLATFORM_CLOUDFLARE_ACCOUNT")
			token = os.Getenv("PLATFORM_CLOUDFLARE_TOKEN")
		}
		credential, e := s.BackupToken(ctx, job)
		if e != nil {
			return state, e
		}
		secretSum := sha256.Sum256([]byte(credential + "\nrestore\n" + id))
		secret := fmt.Sprintf("%x", secretSum)
		digest := sha256.Sum256([]byte(account + "\n" + job))
		directory := filepath.Join(os.Getenv("PLATFORM_JOURNAL_DIRECTORY"), fmt.Sprintf("%x", digest))
		return cloudflare.New(token).RestoreMediaCopy(ctx, directory, account, id, secret, files, state, save)
	}
	go func() {
		lastAuthCleanup := time.Time{}
		lastLifecycle := time.Time{}
		for {
			if time.Since(lastAuthCleanup) > 15*time.Minute {
				cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 20*time.Second)
				_, cleanupErr := db.ExecContext(cleanupCtx, "DELETE FROM portal_sessions WHERE expires_at<=now(); DELETE FROM portal_oauth_states WHERE expires_at<=now(); DELETE FROM portal_auth_limits WHERE reset_at<=now();")
				cleanupCancel()
				if cleanupErr != nil {
					log.Print("Expired authentication data cleanup unavailable")
				} else {
					lastAuthCleanup = time.Now()
				}
			}
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
			err := s.RunOne(ctx, func(ctx context.Context, id string, business []byte) (any, error) {
				if os.Getenv("PLATFORM_HOSTING_APPROVED") != "true" {
					return nil, errors.New("hosting approval required")
				}
				private, e := base64.RawURLEncoding.DecodeString(os.Getenv("PLATFORM_SIGNING_KEY"))
				if e != nil || len(private) != ed25519.PrivateKeySize {
					return nil, errors.New("signing key missing")
				}
				account, token, customerHosted, e := s.JobCredentials(ctx, id)
				if e != nil {
					return nil, e
				}
				if !customerHosted {
					account = os.Getenv("PLATFORM_CLOUDFLARE_ACCOUNT")
					token = os.Getenv("PLATFORM_CLOUDFLARE_TOKEN")
				}
				if len(token) < 20 {
					return nil, errors.New("authorization missing")
				}
				if _, e = cloudflare.New(token).InspectHosting(ctx, account); e != nil {
					return nil, e
				}
				subscriptionURL, subscriptionToken := "", ""
				if !customerHosted {
					if !strings.HasPrefix(s.Origin, "https://") {
						return nil, errors.New("public HTTPS portal required for managed hosting")
					}
					subscriptionURL = s.Origin + "/api/hosting/status"
					subscriptionToken, e = s.HostingGrant(ctx, id)
					if e != nil {
						return nil, e
					}
				}
				backupToken, e := s.BackupToken(ctx, id)
				if e != nil {
					return nil, e
				}
				var siteDomain *cloudflare.SiteDomain
				if !customerHosted && s.SiteDomain != "" {
					slug, e := s.JobSlug(ctx, id)
					if e != nil {
						return nil, e
					}
					// Orders created before addresses existed keep their workers.dev links.
					if slug != "" {
						siteDomain = &cloudflare.SiteDomain{Domain: s.SiteDomain, Zone: s.SiteZone, Slug: slug}
					}
				}
				public := ed25519.PrivateKey(private).Public().(ed25519.PublicKey)
				payload, _ := json.Marshal(cloudflare.License{Version: 1, Product: "food-truck-live", Account: account, OrderID: id})
				license, _ := json.Marshal(map[string]string{"payload": base64.RawURLEncoding.EncodeToString(payload), "signature": base64.RawURLEncoding.EncodeToString(ed25519.Sign(ed25519.PrivateKey(private), payload))})
				return cloudflare.New(token).InstallPilot(ctx, os.Getenv("PLATFORM_JOURNAL_DIRECTORY"), os.Getenv("PLATFORM_PACKAGE_DIRECTORY"), account, id, cloudflare.InstallOptions{Business: business, License: license, PublicKey: public, CostsApproved: true, BackupToken: backupToken, Progress: func(step string) error { return s.RecordProgress(ctx, id, step) }, SubscriptionURL: subscriptionURL, SubscriptionToken: subscriptionToken, MailAPIKey: os.Getenv("PLATFORM_BREVO_API_KEY"), MailFrom: os.Getenv("PLATFORM_MAIL_FROM"), SiteDomain: siteDomain})
			})
			backupErr := s.RunBackupOne(ctx, func(ctx context.Context, id string) (cloudflare.SQLBackup, error) {
				account, token, customerHosted, e := s.JobCredentials(ctx, id)
				if e != nil {
					return cloudflare.SQLBackup{}, e
				}
				if !customerHosted {
					account = os.Getenv("PLATFORM_CLOUDFLARE_ACCOUNT")
					token = os.Getenv("PLATFORM_CLOUDFLARE_TOKEN")
				}
				digest := sha256.Sum256([]byte(account + "\n" + id))
				directory := filepath.Join(os.Getenv("PLATFORM_JOURNAL_DIRECTORY"), fmt.Sprintf("%x", digest))
				client := cloudflare.New(token)
				backup, e := client.ExportSQLFromJournal(ctx, directory, account)
				if e != nil {
					return backup, e
				}
				include, e := s.BackupMediaRequested(ctx, id)
				if e != nil {
					return backup, e
				}
				if include {
					credential, e := s.BackupToken(ctx, id)
					if e != nil {
						return backup, e
					}
					backup.Media, e = client.ExportMediaFromJournal(ctx, directory, account, credential)
					if e != nil {
						return backup, e
					}
				}
				return backup, nil
			})
			restoreErr := s.RunRestoreOne(ctx, func(ctx context.Context, job, id string, sql []byte, checksum string, state cloudflare.RestoreCopy, save func(cloudflare.RestoreCopy) error) (cloudflare.RestoreCopy, error) {
				account, token, customerHosted, e := s.JobCredentials(ctx, job)
				if e != nil {
					return state, e
				}
				if !customerHosted {
					account = os.Getenv("PLATFORM_CLOUDFLARE_ACCOUNT")
					token = os.Getenv("PLATFORM_CLOUDFLARE_TOKEN")
				}
				digest := sha256.Sum256([]byte(account + "\n" + job))
				directory := filepath.Join(os.Getenv("PLATFORM_JOURNAL_DIRECTORY"), fmt.Sprintf("%x", digest))
				private, e := base64.RawURLEncoding.DecodeString(os.Getenv("PLATFORM_SIGNING_KEY"))
				if e != nil || len(private) != ed25519.PrivateKeySize {
					return state, errors.New("signing key unavailable")
				}
				public := ed25519.PrivateKey(private).Public().(ed25519.PublicKey)
				return cloudflare.New(token).ValidateBackupAgainstPackage(ctx, directory, account, id, os.Getenv("PLATFORM_PACKAGE_DIRECTORY"), public, sql, checksum, state, save)
			})
			if restoreErr != nil {
				log.Print("Restore validation runner unavailable")
			}
			if time.Since(lastLifecycle) > 10*time.Minute {
				if e := s.RunLifecycle(ctx); e != nil {
					log.Print("Lifecycle sweep incomplete; it will be retried")
				} else {
					lastLifecycle = time.Now()
				}
			}
			// Removal is destructive, so it stays off until the operator turns it on explicitly.
			if os.Getenv("PLATFORM_TEARDOWN_APPROVED") == "true" {
				if e := s.RunTeardownOne(ctx, func(ctx context.Context, job string) error {
					account, token := os.Getenv("PLATFORM_CLOUDFLARE_ACCOUNT"), os.Getenv("PLATFORM_CLOUDFLARE_TOKEN")
					if len(token) < 20 {
						return errors.New("authorization missing")
					}
					_, e := cloudflare.New(token).TeardownPilot(ctx, os.Getenv("PLATFORM_JOURNAL_DIRECTORY"), account, job)
					return e
				}); e != nil {
					log.Print("Teardown runner unavailable")
				}
			}
			if backupErr != nil {
				log.Print("Backup runner unavailable; check configuration")
			}
			cancel()
			if err != nil {
				log.Print("Platform runner unavailable; check database and configuration")
			}
			time.Sleep(2 * time.Second)
		}
	}()
	addr := os.Getenv("PLATFORM_LISTEN")
	if addr == "" {
		addr = "127.0.0.1:4100"
	}
	log.Print("Platform service listening")
	log.Fatal((&http.Server{Addr: addr, Handler: s, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second, MaxHeaderBytes: 16384}).ListenAndServe())
}

// envInt reads a positive integer environment variable, or returns fallback when unset or invalid.
func envInt(name string, fallback int) int {
	value, err := strconv.Atoi(os.Getenv(name))
	if err != nil || value < 1 {
		return fallback
	}
	return value
}

// trialDays reads PLATFORM_TRIAL_DAYS (1-365). Zero lets the platform default (14 days) apply.
func trialDays() int {
	days, err := strconv.Atoi(os.Getenv("PLATFORM_TRIAL_DAYS"))
	if err != nil || days < 1 || days > 365 {
		return 0
	}
	return days
}
