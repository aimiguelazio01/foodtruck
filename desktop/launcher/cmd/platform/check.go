package main

// `platform -check` tests the real configuration before the first installation: every external
// service is asked read-only questions with the configured credentials. Nothing is created or
// changed, and no secret is ever printed. Run it inside the compose stack so it sees the same
// environment as the service:
//
//	docker compose --env-file .env -f compose.yaml run --rm service -check
//
// or locally with `go run ./cmd/platform -check -env ../../deployment/platform/.env`.

import (
	"bufio"
	"context"
	"crypto/ed25519"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/mail"
	"net/url"
	"os"
	"regexp"
	"slices"
	"strings"
	"time"

	"foodtruck.local/desktop/cloudflare"
)

// stripeEvents are the webhook events the platform handles (platform/billing.go).
var stripeEvents = []string{"checkout.session.completed", "invoice.paid", "invoice.payment_failed",
	"customer.subscription.updated", "customer.subscription.deleted"}

var domainName = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$`)

type checker struct {
	env       func(string) string
	transport http.RoundTripper // nil = the real network
	openDB    func(url string) (*sql.DB, error)
	out       io.Writer
	failed    int
}

func (c *checker) ok(area, text string)   { fmt.Fprintf(c.out, "  ✔ %s: %s\n", area, text) }
func (c *checker) warn(area, text string) { fmt.Fprintf(c.out, "  ! %s: %s\n", area, text) }
func (c *checker) fail(area, text string) {
	c.failed++
	fmt.Fprintf(c.out, "  ✘ %s: %s\n", area, text)
}

func (c *checker) client() *http.Client {
	return &http.Client{Timeout: 20 * time.Second, Transport: c.transport,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

// getJSON performs an authenticated GET and decodes the body. The status is returned even on errors.
func (c *checker) getJSON(ctx context.Context, address string, header map[string]string, into any) (int, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return 0, err
	}
	for name, value := range header {
		request.Header.Set(name, value)
	}
	response, err := c.client().Do(request)
	if err != nil {
		return 0, errors.New("sem resposta")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return response.StatusCode, fmt.Errorf("HTTP %d", response.StatusCode)
	}
	if into != nil && json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(into) != nil {
		return response.StatusCode, errors.New("resposta inesperada")
	}
	return response.StatusCode, nil
}

// runCheck prints one line per check and returns the number of failures.
func (c *checker) run(ctx context.Context) int {
	fmt.Fprintln(c.out, "Verificação da configuração real (só leitura)")
	c.local()
	c.database(ctx)
	c.pkg()
	c.cloudflare(ctx)
	c.brevo(ctx)
	c.stripe(ctx)
	c.portal(ctx)
	if c.failed == 0 {
		fmt.Fprintln(c.out, "Tudo pronto.")
	} else {
		fmt.Fprintf(c.out, "%d problema(s) por resolver. Ver docs/SETUP_REAL.md.\n", c.failed)
	}
	return c.failed
}

func (c *checker) local() {
	const area = "Segredos locais"
	if key, err := base64.RawURLEncoding.DecodeString(c.env("PLATFORM_ENCRYPTION_KEY")); err != nil || len(key) != 32 {
		c.fail(area, "PLATFORM_ENCRYPTION_KEY em falta ou inválida (corra scripts/platform-secrets.mjs)")
	} else {
		c.ok(area, "chave de cifra")
	}
	if len(c.env("PLATFORM_ADMIN_KEY")) < 32 {
		c.fail(area, "PLATFORM_ADMIN_KEY em falta ou curta")
	} else {
		c.ok(area, "chave de administração")
	}
	if _, ok := c.signingKey(); !ok {
		c.fail(area, "PLATFORM_SIGNING_KEY em falta ou inválida")
	} else {
		c.ok(area, "chave de assinatura")
	}
	origin, err := url.Parse(c.env("PLATFORM_ORIGIN"))
	if err != nil || origin.Scheme != "https" || origin.Host == "" || origin.Path != "" && origin.Path != "/" {
		c.fail("Portal", "PLATFORM_ORIGIN tem de ser https://<host> (sem caminho)")
	} else if host := c.env("PLATFORM_PUBLIC_HOST"); host != "" && host != origin.Host {
		c.fail("Portal", "PLATFORM_PUBLIC_HOST não coincide com PLATFORM_ORIGIN")
	} else {
		c.ok("Portal", "origem "+origin.Host)
	}
	if c.env("PLATFORM_HOSTING_APPROVED") != "true" {
		c.warn("Instalações", "PLATFORM_HOSTING_APPROVED não é true: as instalações ficam bloqueadas")
	}
}

func (c *checker) signingKey() (ed25519.PrivateKey, bool) {
	raw, err := base64.RawURLEncoding.DecodeString(c.env("PLATFORM_SIGNING_KEY"))
	if err != nil || len(raw) != ed25519.PrivateKeySize {
		return nil, false
	}
	key := ed25519.PrivateKey(raw)
	// The second half must be the public key of the first, or signatures will not verify.
	return key, ed25519.NewKeyFromSeed(raw[:32]).Public().(ed25519.PublicKey).Equal(ed25519.PublicKey(raw[32:]))
}

func (c *checker) database(ctx context.Context) {
	const area = "PostgreSQL"
	address := c.env("PLATFORM_DATABASE_URL")
	if address == "" {
		c.warn(area, "PLATFORM_DATABASE_URL não definida (normal fora do Docker); não verificado")
		return
	}
	db, err := c.openDB(address)
	if err == nil {
		defer db.Close()
		ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		err = db.PingContext(ctx)
	}
	if err != nil {
		c.fail(area, "sem ligação à base de dados")
		return
	}
	c.ok(area, "ligação")
}

func (c *checker) pkg() {
	const area = "Pacote"
	directory := c.env("PLATFORM_PACKAGE_DIRECTORY")
	if directory == "" {
		directory = c.env("PLATFORM_PACKAGE_HOST_PATH")
	}
	if directory == "" {
		c.fail(area, "pasta do pacote não definida (PLATFORM_PACKAGE_HOST_PATH)")
		return
	}
	key, ok := c.signingKey()
	if !ok {
		c.fail(area, "sem chave de assinatura válida para confirmar o pacote")
		return
	}
	manifest, err := cloudflare.VerifySignedDeploymentPackage(directory, key.Public().(ed25519.PublicKey))
	if err != nil {
		c.fail(area, "pacote inválido ou não assinado com PLATFORM_SIGNING_KEY ("+err.Error()+")")
		return
	}
	c.ok(area, "versão "+manifest.Version+" assinada com a chave configurada")
}

func (c *checker) cloudflare(ctx context.Context) {
	const area = "Cloudflare"
	account, token := c.env("PLATFORM_CLOUDFLARE_ACCOUNT"), strings.TrimSpace(c.env("PLATFORM_CLOUDFLARE_TOKEN"))
	if account == "" || token == "" {
		c.fail(area, "PLATFORM_CLOUDFLARE_ACCOUNT e PLATFORM_CLOUDFLARE_TOKEN são obrigatórios")
		return
	}
	auth := map[string]string{"Authorization": "Bearer " + token}
	base := "https://api.cloudflare.com/client/v4"
	var verified struct {
		Result struct {
			Status string `json:"status"`
		} `json:"result"`
	}
	// User tokens and account-owned tokens are verified on different endpoints.
	_, err := c.getJSON(ctx, base+"/user/tokens/verify", auth, &verified)
	if err != nil || verified.Result.Status != "active" {
		_, err = c.getJSON(ctx, base+"/accounts/"+url.PathEscape(account)+"/tokens/verify", auth, &verified)
	}
	if err != nil || verified.Result.Status != "active" {
		c.fail(area, "token inválido, expirado ou sem acesso à conta")
		return
	}
	c.ok(area, "token ativo")
	report, err := cloudflare.NewWithTransport(token, c.transport).InspectHosting(ctx, account)
	if err != nil {
		c.fail(area, err.Error())
	} else if report.Paid && report.D1 && report.R2 && report.Workers {
		c.ok(area, "Workers Paid ativo; acesso a Workers, D1 e R2")
	}
	domain, zone := c.env("PLATFORM_SITE_DOMAIN"), c.env("PLATFORM_SITE_ZONE_ID")
	if domain == "" && zone == "" {
		// Free account without a domain: sites are served from <name>.workers.dev.
		c.warn(area, "sem domínio próprio: os sites ficam em *.workers.dev (modo gratuito)")
		return
	}
	if !domainName.MatchString(domain) || zone == "" {
		c.fail(area, "PLATFORM_SITE_DOMAIN e PLATFORM_SITE_ZONE_ID são obrigatórios")
		return
	}
	var found struct {
		Result struct {
			Name    string `json:"name"`
			Status  string `json:"status"`
			Account struct {
				ID string `json:"id"`
			} `json:"account"`
		} `json:"result"`
	}
	if _, err := c.getJSON(ctx, base+"/zones/"+url.PathEscape(zone), auth, &found); err != nil {
		c.fail(area, "zona "+domain+" não acessível com este token ("+err.Error()+")")
		return
	}
	switch {
	case found.Result.Name != domain:
		c.fail(area, "PLATFORM_SITE_ZONE_ID pertence a "+found.Result.Name+", não a "+domain)
	case found.Result.Account.ID != account:
		c.fail(area, "a zona "+domain+" não está na conta configurada")
	case found.Result.Status != "active":
		c.fail(area, "a zona "+domain+" ainda não está ativa (nameservers por mudar?)")
	default:
		c.ok(area, "zona "+domain+" ativa")
	}
	if _, err := c.getJSON(ctx, base+"/accounts/"+url.PathEscape(account)+"/workers/domains?zone_id="+url.QueryEscape(zone), auth, nil); err != nil {
		c.fail(area, "sem acesso aos domínios de Workers da zona ("+err.Error()+")")
	} else {
		c.ok(area, "acesso aos domínios de Workers")
	}
}

func (c *checker) brevo(ctx context.Context) {
	const area = "Brevo"
	key := strings.TrimSpace(c.env("PLATFORM_BREVO_API_KEY"))
	from, err := mail.ParseAddress(c.env("PLATFORM_MAIL_FROM"))
	if key == "" || err != nil {
		c.fail(area, "PLATFORM_BREVO_API_KEY e PLATFORM_MAIL_FROM (ex.: Food Truck Live <nao-responder@dominio>) são obrigatórios")
		return
	}
	auth := map[string]string{"api-key": key, "Accept": "application/json"}
	if _, err := c.getJSON(ctx, "https://api.brevo.com/v3/account", auth, nil); err != nil {
		c.fail(area, "chave API recusada ("+err.Error()+")")
		return
	}
	c.ok(area, "chave API aceite")
	var senders struct {
		Senders []struct {
			Email  string `json:"email"`
			Active bool   `json:"active"`
		} `json:"senders"`
	}
	if _, err := c.getJSON(ctx, "https://api.brevo.com/v3/senders", auth, &senders); err != nil {
		c.fail(area, "não foi possível ler os remetentes ("+err.Error()+")")
	} else if !slices.ContainsFunc(senders.Senders, func(s struct {
		Email  string `json:"email"`
		Active bool   `json:"active"`
	}) bool {
		return strings.EqualFold(s.Email, from.Address) && s.Active
	}) {
		c.fail(area, "o remetente "+from.Address+" não existe ou não está ativo na Brevo")
	} else {
		c.ok(area, "remetente "+from.Address+" ativo")
	}
	domain := from.Address[strings.LastIndex(from.Address, "@")+1:]
	var domains struct {
		Domains []struct {
			Name          string `json:"domain_name"`
			Authenticated bool   `json:"authenticated"`
		} `json:"domains"`
	}
	if _, err := c.getJSON(ctx, "https://api.brevo.com/v3/senders/domains", auth, &domains); err != nil {
		c.warn(area, "não foi possível confirmar a autenticação do domínio "+domain+"; confirme no painel Brevo")
		return
	}
	for _, d := range domains.Domains {
		if strings.EqualFold(d.Name, domain) && d.Authenticated {
			c.ok(area, "domínio "+domain+" autenticado (DKIM/DMARC)")
			return
		}
	}
	if c.env("PLATFORM_SITE_DOMAIN") == "" {
		c.warn(area, "o domínio "+domain+" não está autenticado: aceitável no teste gratuito, mas os emails podem ir para spam")
		return
	}
	c.fail(area, "o domínio "+domain+" não está autenticado: os emails irão para spam ou serão recusados")
}

func (c *checker) stripe(ctx context.Context) {
	const area = "Stripe"
	key, secret, price := strings.TrimSpace(c.env("STRIPE_SECRET_KEY")), c.env("STRIPE_WEBHOOK_SECRET"), c.env("STRIPE_PRICE_ID")
	if key == "" || !strings.HasPrefix(secret, "whsec_") || !strings.HasPrefix(price, "price_") {
		c.fail(area, "STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (whsec_…) e STRIPE_PRICE_ID (price_…) são obrigatórios")
		return
	}
	mode := "teste"
	if strings.Contains(key, "_live_") {
		mode = "PRODUÇÃO (pagamentos reais)"
	}
	auth := map[string]string{"Authorization": "Bearer " + key}
	var found struct {
		Active    bool   `json:"active"`
		Currency  string `json:"currency"`
		Type      string `json:"type"`
		Amount    int64  `json:"unit_amount"`
		Recurring struct {
			Interval string `json:"interval"`
		} `json:"recurring"`
	}
	if _, err := c.getJSON(ctx, "https://api.stripe.com/v1/prices/"+url.PathEscape(price), auth, &found); err != nil {
		c.fail(area, "preço não encontrado com esta chave ("+err.Error()+"); chave e preço têm de ser do mesmo modo")
		return
	}
	if !found.Active || found.Type != "recurring" {
		c.fail(area, "o preço tem de estar ativo e ser recorrente")
	} else {
		c.ok(area, fmt.Sprintf("modo %s; preço %.2f %s por %s", mode, float64(found.Amount)/100, strings.ToUpper(found.Currency), found.Recurring.Interval))
	}
	var hooks struct {
		Data []struct {
			URL    string   `json:"url"`
			Status string   `json:"status"`
			Events []string `json:"enabled_events"`
		} `json:"data"`
	}
	endpoint := strings.TrimRight(c.env("PLATFORM_ORIGIN"), "/") + "/stripe/webhook"
	if _, err := c.getJSON(ctx, "https://api.stripe.com/v1/webhook_endpoints?limit=100", auth, &hooks); err != nil {
		c.fail(area, "não foi possível ler os webhooks ("+err.Error()+")")
		return
	}
	for _, hook := range hooks.Data {
		if hook.URL != endpoint {
			continue
		}
		var missing []string
		for _, event := range stripeEvents {
			if !slices.Contains(hook.Events, event) && !slices.Contains(hook.Events, "*") {
				missing = append(missing, event)
			}
		}
		switch {
		case hook.Status != "enabled":
			c.fail(area, "o webhook "+endpoint+" está desativado")
		case len(missing) > 0:
			c.fail(area, "faltam eventos no webhook: "+strings.Join(missing, ", "))
		default:
			c.ok(area, "webhook "+endpoint+" com os 5 eventos")
		}
		return
	}
	if c.env("PLATFORM_SITE_DOMAIN") == "" {
		c.warn(area, "sem webhook no painel (modo gratuito): os eventos chegam pela Stripe CLI (stripe listen --forward-to localhost:4100/stripe/webhook)")
		return
	}
	c.fail(area, "não existe webhook para "+endpoint)
}

func (c *checker) portal(ctx context.Context) {
	const area = "Portal"
	origin := strings.TrimRight(c.env("PLATFORM_ORIGIN"), "/")
	if !strings.HasPrefix(origin, "https://") {
		return // already reported
	}
	status, err := c.getJSON(ctx, origin+"/", nil, nil)
	if err != nil && status == 0 {
		c.fail(area, origin+" não responde (portal ou túnel parado?)")
		return
	}
	// 404/502/530 from Cloudflare usually mean the tunnel route or the portal container is missing.
	if status >= 400 {
		c.fail(area, fmt.Sprintf("%s responde HTTP %d (rota do túnel ou portal em falta?)", origin, status))
		return
	}
	c.ok(area, origin+" responde em HTTPS")
}

// loadEnvFile sets the KEY=VALUE pairs of a .env file that are not already in the environment.
func loadEnvFile(path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		name, value, ok := strings.Cut(line, "=")
		if !ok || strings.HasPrefix(line, "#") || name == "" {
			continue
		}
		if _, set := os.LookupEnv(name); !set {
			os.Setenv(name, strings.Trim(value, `"'`))
		}
	}
	return scanner.Err()
}

// checkCommand handles `platform -check [-env file]`. It returns false when the arguments are not a check.
func checkCommand(args []string) (exit int, handled bool) {
	if len(args) == 0 || args[0] != "-check" {
		return 0, false
	}
	if len(args) == 3 && args[1] == "-env" {
		if err := loadEnvFile(args[2]); err != nil {
			fmt.Fprintln(os.Stderr, "Não foi possível ler o ficheiro .env")
			return 2, true
		}
	} else if len(args) != 1 {
		fmt.Fprintln(os.Stderr, "Utilização: platform -check [-env <ficheiro .env>]")
		return 2, true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	c := &checker{env: os.Getenv, out: os.Stdout, openDB: func(u string) (*sql.DB, error) { return sql.Open("pgx", u) }}
	if c.run(ctx) > 0 {
		return 1, true
	}
	return 0, true
}
