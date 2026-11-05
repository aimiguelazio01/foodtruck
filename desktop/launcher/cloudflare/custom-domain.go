package cloudflare

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"
)

// SiteDomain places an installation's public sites on the operator's own domain, for example
// bella.example.pt and bella-gestao.example.pt, instead of workers.dev addresses.
type SiteDomain struct {
	Domain string // zone apex that Cloudflare manages, e.g. example.pt
	Zone   string // Cloudflare zone ID of that domain
	Slug   string // customer-chosen label, validated by ValidSlug
}

var (
	slugPattern   = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$`)
	domainPattern = regexp.MustCompile(`^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$`)
	zonePattern   = regexp.MustCompile(`^[0-9a-f]{32}$`)
	reservedSlugs = []string{"www", "mail", "admin", "api", "app", "instalar", "portal", "gestao", "ftp", "smtp", "imap", "pop", "ns1", "ns2", "status", "support", "suporte", "cloud", "static", "assets", "cdn", "dev", "test", "staging"}
	// Certificate issuance for a new hostname can lag the attachment by a minute or two.
	domainVerifyAttempts = 24
	domainVerifyDelay    = 5 * time.Second
)

// ValidSlug accepts 3-40 lowercase letters, digits and inner hyphens. Names that could be
// mistaken for infrastructure, or for another customer's management address, are refused.
func ValidSlug(slug string) bool {
	if !slugPattern.MatchString(slug) || strings.Contains(slug, "--") || strings.HasSuffix(slug, "-gestao") || strings.HasPrefix(slug, "foodtruck-") {
		return false
	}
	return !slices.Contains(reservedSlugs, slug)
}

func (d SiteDomain) valid() bool {
	return ValidSlug(d.Slug) && domainPattern.MatchString(d.Domain) && zonePattern.MatchString(d.Zone)
}

func (d SiteDomain) customerHost() string   { return d.Slug + "." + d.Domain }
func (d SiteDomain) managementHost() string { return d.Slug + "-gestao." + d.Domain }

type workerDomain struct {
	ID       string `json:"id"`
	Hostname string `json:"hostname"`
	Service  string `json:"service"`
	Zone     string `json:"zone_id"`
}

// attachWorkerDomain binds hostname to a Worker. It never takes over a hostname that is
// already bound to a different Worker, so one customer cannot claim another's address.
func (c *Client) attachWorkerDomain(ctx context.Context, account, zone, hostname, service string) error {
	var existing []workerDomain
	query := url.Values{"hostname": {hostname}}.Encode()
	if _, err := c.request(ctx, http.MethodGet, "/accounts/"+account+"/workers/domains?"+query, nil, &existing); err != nil {
		return err
	}
	for _, domain := range existing {
		if domain.Hostname != hostname {
			continue
		}
		if domain.Service == service {
			return nil
		}
		return errors.New("The chosen address is already in use")
	}
	_, err := c.request(ctx, http.MethodPut, "/accounts/"+account+"/workers/domains", map[string]string{
		"hostname": hostname, "service": service, "zone_id": zone, "environment": "production"}, nil)
	return err
}

// attachSiteDomains records its intent in the journal first so a lost response or crash can be
// reconciled and cleaned up later, then binds both public hostnames. Repeating it is safe.
func (c *Client) attachSiteDomains(ctx context.Context, state ProvisionState, domain SiteDomain, save func(ProvisionState) error) (ProvisionState, error) {
	if !domain.valid() {
		return state, errors.New("Invalid site address configuration")
	}
	targets := map[string]string{
		domain.customerHost():   state.Name + "-customer",
		domain.managementHost(): state.Name + "-management",
	}
	hosts := []string{domain.customerHost(), domain.managementHost()}
	for _, host := range hosts {
		if !slices.Contains(state.Domains, host) {
			state.Domains = append(state.Domains, host)
		}
	}
	if err := save(state); err != nil {
		return state, err
	}
	for _, host := range hosts {
		if err := c.attachWorkerDomain(ctx, state.Account, domain.Zone, host, targets[host]); err != nil {
			return state, err
		}
	}
	return state, nil
}
