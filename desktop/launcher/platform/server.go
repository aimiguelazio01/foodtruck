package platform

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"foodtruck.local/desktop/cloudflare"
	"io"
	"net/http"
	"strings"
	"time"
)

//go:embed schema.sql
var Schema string

type Server struct {
	RestoreImages   func(context.Context, string, string, map[string][]byte, cloudflare.RestoreCopy, func(cloudflare.RestoreCopy) error) (cloudflare.RestoreCopy, error)
	PlatformAccount string
	PlatformToken   string
	Accounts        func(context.Context, string) ([]cloudflare.Account, error)
	OAuth           OAuthConfig
	DB              *sql.DB
	AdminKey        string
	Key             []byte
	Origin          string
	// SiteDomain and SiteZone put managed sites on the operator's domain (slug.domain). Empty keeps workers.dev.
	SiteDomain string
	SiteZone   string
	// Self-service signup, trial and Stripe billing. Empty values disable the matching feature.
	TrialDays    int
	BrevoKey     string
	MailFrom     string
	Mail         func(ctx context.Context, to, subject, text string) error // replaces Brevo (tests)
	StripeKey    string
	StripeSecret string // webhook signing secret
	StripePrice  string
	StripeBase   string // tests only
	// RetentionDays is how long a suspended installation keeps its data before removal (default 30).
	RetentionDays int
	// MaxInstallations caps managed installations (0 = unlimited); set it from the Cloudflare account quotas.
	MaxInstallations int
}

func ID() string {
	var b [24]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
func digest(v string) string { h := sha256.Sum256([]byte(v)); return hex.EncodeToString(h[:]) }
func Seal(key, data []byte, id string) ([]byte, error) {
	b, e := aes.NewCipher(key)
	if e != nil {
		return nil, e
	}
	g, e := cipher.NewGCM(b)
	if e != nil {
		return nil, e
	}
	nonce := make([]byte, g.NonceSize())
	if _, e = rand.Read(nonce); e != nil {
		return nil, e
	}
	return g.Seal(nonce, nonce, data, []byte(id)), nil
}
func Open(key, data []byte, id string) ([]byte, error) {
	b, e := aes.NewCipher(key)
	if e != nil {
		return nil, e
	}
	g, e := cipher.NewGCM(b)
	if e != nil {
		return nil, e
	}
	if len(data) < g.NonceSize() {
		return nil, errors.New("invalid ciphertext")
	}
	return g.Open(nil, data[:g.NonceSize()], data[g.NonceSize():], []byte(id))
}
func reply(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func read(w http.ResponseWriter, r *http.Request, v any) bool {
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384))
	d.DisallowUnknownFields()
	if d.Decode(v) != nil {
		return false
	}
	return d.Decode(new(any)) == io.EOF
}
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" && r.URL.Path == "/hosting/status" {
		s.hostingStatus(w, r)
		return
	}
	if r.Method == "GET" && r.URL.Path == "/oauth/callback" {
		s.oauthCallback(w, r)
		return
	}
	if r.Method == "POST" && r.URL.Path == "/stripe/webhook" {
		s.stripeWebhook(w, r) // called by Stripe: authenticated by signature, not by Origin
		return
	}
	if r.Method != "GET" && r.Header.Get("Origin") != s.Origin {
		reply(w, 403, map[string]string{"message": "Origem inválida."})
		return
	}
	if r.Method == "POST" && r.URL.Path == "/auth/signup" {
		s.signup(w, r)
		return
	}
	if r.Method == "POST" && r.URL.Path == "/auth/verify" {
		s.verifyEmail(w, r)
		return
	}
	if r.URL.Path == "/auth/login" || r.URL.Path == "/auth/activate" || r.URL.Path == "/auth/logout" {
		s.auth(w, r)
		return
	}
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	admin := len(token) >= 32 && len(s.AdminKey) >= 32 && subtle.ConstantTimeCompare([]byte(token), []byte(s.AdminKey)) == 1
	if strings.HasPrefix(r.URL.Path, "/admin/") {
		if !admin {
			reply(w, 401, map[string]string{"message": "Acesso administrativo necessário."})
			return
		}
		if r.Method == "POST" && r.URL.Path == "/admin/subscriptions" {
			s.subscriptionAction(w, r, "operator", true)
			return
		}
		if r.Method == "GET" && r.URL.Path == "/admin/orders" {
			s.adminOrders(w, r)
			return
		}
		if r.Method == "POST" && r.URL.Path == "/admin/orders" {
			var in struct {
				Name string `json:"name"`
				Mode string `json:"mode"`
			}
			if !read(w, r, &in) || in.Name == "" || len(in.Name) > 100 || (in.Mode != "platform" && in.Mode != "customer") {
				reply(w, 400, map[string]string{"message": "Dados inválidos."})
				return
			}
			customer, order, access := ID(), ID(), ID()
			tx, e := s.DB.BeginTx(r.Context(), nil)
			if e != nil {
				reply(w, 503, map[string]string{"message": "Base indisponível."})
				return
			}
			defer tx.Rollback()
			_, e = tx.ExecContext(r.Context(), "INSERT INTO portal_customers VALUES ($1,$2,$3)", customer, in.Name, digest(access))
			if e == nil {
				_, e = tx.ExecContext(r.Context(), "INSERT INTO portal_orders(id,customer_id,mode,active_until) VALUES ($1,$2,$3,now()+interval '30 days')", order, customer, in.Mode)
			}
			if e == nil {
				e = tx.Commit()
			}
			if e != nil {
				reply(w, 503, map[string]string{"message": "Não foi possível criar a compra."})
				return
			}
			reply(w, 201, map[string]string{"order": order, "accessCode": access})
			return
		}
		reply(w, 404, map[string]string{"message": "Operação indisponível."})
		return
	}
	customer := s.sessionCustomer(r)
	if customer == "" && (len(token) < 32 || s.DB.QueryRowContext(r.Context(), "SELECT id FROM portal_customers WHERE access_hash=$1", digest(token)).Scan(&customer) != nil) {
		reply(w, 401, map[string]string{"message": "Código de acesso inválido."})
		return
	}
	if r.Method == "GET" && r.URL.Path == "/slugs/check" {
		s.slugCheck(w, r, customer)
		return
	}
	if r.Method == "POST" && (r.URL.Path == "/billing/checkout" || r.URL.Path == "/billing/portal") {
		s.billing(w, r, customer)
		return
	}
	if r.Method == "POST" && r.URL.Path == "/hosting/check" {
		s.hostingCheck(w, r, customer)
		return
	}
	if (r.Method == "GET" || r.Method == "POST") && r.URL.Path == "/restores" {
		s.restores(w, r, customer)
		return
	}
	if (r.Method == "GET" || r.Method == "POST") && r.URL.Path == "/backups" {
		s.backups(w, r, customer)
		return
	}
	if r.Method == "POST" && r.URL.Path == "/subscriptions/action" {
		s.subscriptionAction(w, r, customer, false)
		return
	}
	if r.Method == "GET" && r.URL.Path == "/oauth/accounts" {
		s.accounts(w, r, customer)
		return
	}
	if r.Method == "POST" && r.URL.Path == "/oauth/start" {
		s.oauthStart(w, r, customer)
		return
	}
	if r.Method == "POST" && r.URL.Path == "/jobs/action" {
		s.jobAction(w, r, customer)
		return
	}
	if r.Method == "GET" && r.URL.Path == "/orders" {
		rows, e := s.DB.QueryContext(r.Context(), `SELECT o.id,o.mode,o.active_until,coalesce(j.state,'new'),coalesce(j.message,''),coalesce(j.result,'{}'::jsonb),coalesce(j.step,''),o.plan_status,o.trial_ends_at,o.cancel_requested FROM portal_orders o LEFT JOIN portal_jobs j ON j.order_id=o.id WHERE o.customer_id=$1 ORDER BY o.id`, customer)
		if e != nil {
			reply(w, 503, map[string]string{"message": "Consulta indisponível."})
			return
		}
		defer rows.Close()
		result := []map[string]any{}
		for rows.Next() {
			var id, mode, state, message, step, plan string
			var until time.Time
			var trialEnds sql.NullTime
			var cancelling bool
			var raw json.RawMessage
			if rows.Scan(&id, &mode, &until, &state, &message, &raw, &step, &plan, &trialEnds, &cancelling) != nil {
				reply(w, 503, map[string]string{"message": "Consulta indisponível."})
				return
			}
			result = append(result, map[string]any{"id": id, "mode": mode, "activeUntil": until, "state": state, "message": message, "addresses": raw, "step": step, "planStatus": plan, "trialEndsAt": trialEnds.Time, "cancelAtPeriodEnd": cancelling})
		}
		reply(w, 200, result)
		return
	}
	if r.Method == "POST" && r.URL.Path == "/install" {
		var in struct {
			Order         string          `json:"order"`
			Account       string          `json:"account"`
			Business      json.RawMessage `json:"business"`
			CostsApproved bool            `json:"costsApproved"`
			Slug          string          `json:"slug"`
		}
		if !read(w, r, &in) || !in.CostsApproved || !json.Valid(in.Business) {
			reply(w, 400, map[string]string{"message": "Confirme os dados e os custos."})
			return
		}
		// Ownership and entitlement are checked in the same transaction as enqueueing.
		tx, e := s.DB.BeginTx(r.Context(), nil)
		if e != nil {
			reply(w, 503, map[string]string{"message": "Fila indisponível."})
			return
		}
		defer tx.Rollback()
		var mode, existingAccount string
		e = tx.QueryRowContext(r.Context(), "SELECT mode,account_id FROM portal_orders WHERE id=$1 AND customer_id=$2 AND active_until>now() FOR UPDATE", in.Order, customer).Scan(&mode, &existingAccount)
		if e != nil {
			reply(w, 404, map[string]string{"message": "Compra indisponível."})
			return
		}
		if mode == "customer" {
			if !accountPattern.MatchString(in.Account) || (existingAccount != "" && existingAccount != in.Account) {
				reply(w, 409, map[string]string{"message": "Selecione a conta autorizada. Uma instalação iniciada mantém a mesma conta."})
				return
			}
			token, err := s.customerToken(r.Context(), customer)
			if err != nil {
				reply(w, 409, map[string]string{"message": "Ligue novamente a conta Cloudflare antes de instalar."})
				return
			}
			accounts, err := s.accountList(r.Context(), token)
			allowed := false
			for _, account := range accounts {
				if account.ID == in.Account {
					allowed = true
				}
			}
			if err != nil || !allowed {
				reply(w, 403, map[string]string{"message": "A conta selecionada não está autorizada."})
				return
			}
			if _, err = tx.ExecContext(r.Context(), "UPDATE portal_orders SET account_id=$2 WHERE id=$1", in.Order, in.Account); err != nil {
				reply(w, 503, map[string]string{"message": "Não foi possível associar a conta."})
				return
			}
		}

		if mode == "platform" {
			var existing int
			if e = tx.QueryRowContext(r.Context(), "SELECT count(*) FROM portal_jobs WHERE order_id=$1", in.Order).Scan(&existing); e == nil && existing == 0 {
				full, e2 := s.installationCapacityReached(r.Context(), tx)
				if e2 != nil {
					reply(w, 503, map[string]string{"message": "Fila indisponível."})
					return
				}
				if full {
					reply(w, 503, map[string]string{"message": "De momento não há capacidade para novas instalações. Tente novamente mais tarde."})
					return
				}
			} else if e != nil {
				reply(w, 503, map[string]string{"message": "Fila indisponível."})
				return
			}
		}
		if mode == "platform" && s.SiteDomain != "" {
			if !cloudflare.ValidSlug(in.Slug) {
				reply(w, 400, map[string]string{"message": "Escolha um endereço com 3 a 40 letras minúsculas, números ou hífenes."})
				return
			}
			var holder string
			e = tx.QueryRowContext(r.Context(), "SELECT order_id FROM portal_slugs WHERE slug=$1", in.Slug).Scan(&holder)
			if e == nil && holder != in.Order {
				reply(w, 409, map[string]string{"message": "Esse endereço já está em uso. Escolha outro."})
				return
			}
			if e != nil && e != sql.ErrNoRows {
				reply(w, 503, map[string]string{"message": "Fila indisponível."})
				return
			}
			// An order keeps the first address it reserved; a repeated request cannot move a site.
			if _, e = tx.ExecContext(r.Context(), "INSERT INTO portal_slugs(slug,order_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", in.Slug, in.Order); e != nil {
				reply(w, 409, map[string]string{"message": "Esse endereço já está em uso. Escolha outro."})
				return
			}
		}

		id := ID()
		encrypted, e := Seal(s.Key, in.Business, id)
		if e != nil {
			reply(w, 503, map[string]string{"message": "Configuração segura indisponível."})
			return
		}
		_, e = tx.ExecContext(r.Context(), "INSERT INTO portal_jobs(id,order_id,state,payload) VALUES ($1,$2,'queued',$3) ON CONFLICT(order_id) DO NOTHING", id, in.Order, encrypted)
		if e == nil {
			e = tx.Commit()
		}
		if e != nil {
			reply(w, 503, map[string]string{"message": "Fila indisponível."})
			return
		}
		reply(w, 202, map[string]string{"message": "Instalação registada."})
		return
	}
	reply(w, 404, map[string]string{"message": "Operação indisponível."})
}

type Deploy func(context.Context, string, []byte) (any, error)

// A PostgreSQL advisory lock held on this connection prevents overlapping runners.
// A crash releases the lock; the next runner reconciles the persisted deployment journal.
func (s *Server) RunOne(ctx context.Context, deploy Deploy) error {
	conn, e := s.DB.Conn(ctx)
	if e != nil {
		return e
	}
	defer conn.Close()
	var locked bool
	if e = conn.QueryRowContext(ctx, "SELECT pg_try_advisory_lock(482019621)").Scan(&locked); e != nil || !locked {
		return e
	}
	defer conn.ExecContext(context.Background(), "SELECT pg_advisory_unlock(482019621)")
	var id string
	var data []byte
	e = conn.QueryRowContext(ctx, "SELECT j.id,j.payload FROM portal_jobs j JOIN portal_orders o ON o.id=j.order_id WHERE j.state IN ('queued','running') AND o.active_until>now() ORDER BY j.created_at LIMIT 1").Scan(&id, &data)
	if e == sql.ErrNoRows {
		return nil
	}
	if e != nil {
		return e
	}
	if _, e = conn.ExecContext(ctx, "UPDATE portal_jobs SET state='running',updated_at=now() WHERE id=$1", id); e != nil {
		return e
	}
	clear, e := Open(s.Key, data, id)
	if e != nil {
		return e
	}
	defer func() {
		for i := range clear {
			clear[i] = 0
		}
	}()
	result, e := deploy(ctx, id, clear)
	if e != nil {
		// The customer sees a short message; the operator needs the real cause (no secrets: errors carry API messages only).
		log.Printf("installation %s blocked: %v", id, e)
		message := "Verifique a configura\u00e7\u00e3o do alojamento. Os recursos existentes foram preservados."
		var hostingError *cloudflare.HostingError
		if errors.As(e, &hostingError) {
			message = hostingError.Message
		}
		if errors.Is(e, ErrAuthorization) {
			message = "A autoriza\u00e7\u00e3o Cloudflare expirou ou deixou de permitir acesso. Ligue novamente a conta e retome a instala\u00e7\u00e3o."
		}
		_, dbErr := conn.ExecContext(ctx, "UPDATE portal_jobs SET state='blocked',message=$2,updated_at=now() WHERE id=$1", id, message)
		return dbErr
	}
	raw, e := json.Marshal(result)
	if e != nil {
		return e
	}
	_, e = conn.ExecContext(ctx, "UPDATE portal_jobs SET state='ready',result=$2,payload=NULL,message='',updated_at=now() WHERE id=$1", id, string(raw))
	return e
}
