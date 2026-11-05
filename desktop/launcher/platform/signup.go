package platform

import (
	"foodtruck.local/desktop/cloudflare"
	"net/http"
	"regexp"
	"strings"
	"time"
)

var emailPattern = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

const verifyTokenLife = 24 * time.Hour

func (s *Server) trialDays() int {
	if s.TrialDays > 0 {
		return s.TrialDays
	}
	return 14
}

// signup creates a self-service account. The answer is the same whether or not the email is
// already registered, so the form cannot be used to discover customers.
func (s *Server) signup(w http.ResponseWriter, r *http.Request) {
	if !s.MailReady() {
		reply(w, 503, map[string]string{"message": "O registo ainda não está disponível. Tente mais tarde."})
		return
	}
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !read(w, r, &in) || len(in.Password) < 12 || len(in.Password) > 256 || len(in.Email) > 254 {
		reply(w, 400, map[string]string{"message": "Indique um email e uma palavra-passe com pelo menos 12 caracteres."})
		return
	}
	email := strings.ToLower(strings.TrimSpace(in.Email))
	if !emailPattern.MatchString(email) {
		reply(w, 400, map[string]string{"message": "Email inválido."})
		return
	}
	if !s.authAttempt(r.Context(), "global-signup", 200) || !s.authAttempt(r.Context(), "signup:"+email, 3) {
		reply(w, 429, map[string]string{"message": "Demasiadas tentativas. Aguarde 15 minutos."})
		return
	}
	ok := map[string]string{"message": "Enviámos um email para confirmar a conta. A ligação é válida durante 24 horas."}
	var customer string
	var verified bool
	found := s.DB.QueryRowContext(r.Context(), "SELECT id,email_verified FROM portal_customers WHERE email=$1", email).Scan(&customer, &verified) == nil
	if found && verified {
		reply(w, 200, ok)
		return
	}
	created := false
	if !found {
		customer = ID()
		// access_hash is required and unique; self-service accounts never use an access code.
		if _, e := s.DB.ExecContext(r.Context(), "INSERT INTO portal_customers(id,name,access_hash,email,password_hash,email_verified) VALUES ($1,$2,$3,$2,$4,false)",
			customer, email, digest(ID()), passwordHash(in.Password)); e != nil {
			reply(w, 503, map[string]string{"message": "Não foi possível criar a conta."})
			return
		}
		created = true
	}
	token := ID()
	if _, e := s.DB.ExecContext(r.Context(), "DELETE FROM portal_email_tokens WHERE customer_id=$1", customer); e != nil {
		reply(w, 503, map[string]string{"message": "Não foi possível criar a conta."})
		return
	}
	if _, e := s.DB.ExecContext(r.Context(), "INSERT INTO portal_email_tokens VALUES ($1,$2,$3)", digest(token), customer, time.Now().Add(verifyTokenLife)); e != nil {
		reply(w, 503, map[string]string{"message": "Não foi possível criar a conta."})
		return
	}
	text := "Para ativar a sua conta Food Truck Live, abra esta ligação:\n\n" + s.Origin + "/?verify=" + token +
		"\n\nA ligação é válida durante 24 horas. Se não pediu este registo, ignore este email."
	if e := s.sendMail(r.Context(), email, "Confirme o seu email — Food Truck Live", text); e != nil {
		if created {
			_, _ = s.DB.ExecContext(r.Context(), "DELETE FROM portal_email_tokens WHERE customer_id=$1", customer)
			_, _ = s.DB.ExecContext(r.Context(), "DELETE FROM portal_customers WHERE id=$1 AND NOT email_verified", customer)
		}
		reply(w, 502, map[string]string{"message": "Não foi possível enviar o email. Tente novamente mais tarde."})
		return
	}
	reply(w, 200, ok)
}

// verifyEmail confirms the address, starts the free trial and signs the customer in.
func (s *Server) verifyEmail(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Token string `json:"token"`
	}
	if !read(w, r, &in) || len(in.Token) != 48 {
		reply(w, 400, map[string]string{"message": "Ligação inválida ou expirada."})
		return
	}
	if !s.authAttempt(r.Context(), "global-verify", 200) {
		reply(w, 429, map[string]string{"message": "Demasiadas tentativas. Aguarde 15 minutos."})
		return
	}
	tx, e := s.DB.BeginTx(r.Context(), nil)
	if e != nil {
		reply(w, 503, map[string]string{"message": "Serviço indisponível."})
		return
	}
	defer tx.Rollback()
	var customer string
	if tx.QueryRowContext(r.Context(), "DELETE FROM portal_email_tokens WHERE hash=$1 AND expires_at>now() RETURNING customer_id", digest(in.Token)).Scan(&customer) != nil {
		reply(w, 400, map[string]string{"message": "Ligação inválida ou expirada."})
		return
	}
	if _, e = tx.ExecContext(r.Context(), "UPDATE portal_customers SET email_verified=true WHERE id=$1", customer); e != nil {
		reply(w, 503, map[string]string{"message": "Serviço indisponível."})
		return
	}
	// One trial per account: only create an order when the customer has none yet.
	days := s.trialDays()
	if _, e = tx.ExecContext(r.Context(), `INSERT INTO portal_orders(id,customer_id,mode,active_until,simulated,plan_status,trial_ends_at)
		SELECT $1,$2,'platform',now()+make_interval(days => $3::int),false,'trialing',now()+make_interval(days => $3::int)
		WHERE NOT EXISTS (SELECT 1 FROM portal_orders WHERE customer_id=$2)`, ID(), customer, days); e != nil {
		reply(w, 503, map[string]string{"message": "Serviço indisponível."})
		return
	}
	session := ID()
	if _, e = tx.ExecContext(r.Context(), "INSERT INTO portal_sessions VALUES ($1,$2,$3)", digest(session), customer, time.Now().Add(8*time.Hour)); e != nil {
		reply(w, 503, map[string]string{"message": "Serviço indisponível."})
		return
	}
	if e = tx.Commit(); e != nil {
		reply(w, 503, map[string]string{"message": "Serviço indisponível."})
		return
	}
	s.sessionCookie(w, session, 28800)
	reply(w, 200, map[string]bool{"ok": true})
}

// slugCheck tells the signed-in customer whether a site address can be chosen, and what the address
// will look like. An empty slug only returns the domain, which lets the page know addresses are in use.
func (s *Server) slugCheck(w http.ResponseWriter, r *http.Request, customer string) {
	if !s.authAttempt(r.Context(), "slug:"+customer, 120) {
		reply(w, 429, map[string]string{"message": "Demasiados pedidos. Aguarde alguns minutos."})
		return
	}
	slug := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("slug")))
	answer := map[string]any{"domain": s.SiteDomain, "available": false}
	if s.SiteDomain == "" || slug == "" {
		reply(w, 200, answer)
		return
	}
	if !cloudflare.ValidSlug(slug) {
		answer["reason"] = "invalid"
		reply(w, 200, answer)
		return
	}
	var taken bool
	if e := s.DB.QueryRowContext(r.Context(), "SELECT EXISTS (SELECT 1 FROM portal_slugs WHERE slug=$1)", slug).Scan(&taken); e != nil {
		reply(w, 503, map[string]string{"message": "Consulta indisponível."})
		return
	}
	if taken {
		answer["reason"] = "taken"
	} else {
		answer["available"] = true
	}
	reply(w, 200, answer)
}
