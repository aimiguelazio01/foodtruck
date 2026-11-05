package platform

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"golang.org/x/crypto/pbkdf2"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const passwordRounds = 600000

func passwordHash(password string) string {
	salt := make([]byte, 16)
	if _, e := rand.Read(salt); e != nil {
		panic(e)
	}
	hash := pbkdf2.Key([]byte(password), salt, passwordRounds, 32, sha256.New)
	return "pbkdf2-sha256$600000$" + hex.EncodeToString(salt) + "$" + hex.EncodeToString(hash)
}
func passwordMatches(password, stored string) bool {
	parts := strings.Split(stored, "$")
	salt := make([]byte, 16)
	expected := make([]byte, 32)
	valid := false
	if len(parts) == 4 && parts[0] == "pbkdf2-sha256" && parts[1] == "600000" {
		s, e := hex.DecodeString(parts[2])
		h, e2 := hex.DecodeString(parts[3])
		if e == nil && e2 == nil && len(s) == 16 && len(h) == 32 {
			salt = s
			expected = h
			valid = true
		}
	}
	actual := pbkdf2.Key([]byte(password), salt, passwordRounds, 32, sha256.New)
	return subtle.ConstantTimeCompare(actual, expected) == 1 && valid
}
func (s *Server) authAttempt(ctx context.Context, key string, maximum int) bool {
	var count int
	return s.DB.QueryRowContext(ctx, `INSERT INTO portal_auth_limits VALUES ($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN portal_auth_limits.reset_at<=now() THEN 1 ELSE portal_auth_limits.attempts+1 END,reset_at=CASE WHEN portal_auth_limits.reset_at<=now() THEN excluded.reset_at ELSE portal_auth_limits.reset_at END WHERE portal_auth_limits.reset_at<=now() OR portal_auth_limits.attempts<$2 RETURNING attempts`, digest(key), maximum).Scan(&count) == nil
}
func (s *Server) sessionCookie(w http.ResponseWriter, value string, age int) {
	http.SetCookie(w, &http.Cookie{Name: "portal_session", Value: value, Path: "/api", HttpOnly: true, Secure: strings.HasPrefix(s.Origin, "https://"), SameSite: http.SameSiteLaxMode, MaxAge: age})
}
func (s *Server) sessionCustomer(r *http.Request) string {
	cookie, e := r.Cookie("portal_session")
	if e != nil || len(cookie.Value) != 48 {
		return ""
	}
	var customer string
	_ = s.DB.QueryRowContext(r.Context(), "SELECT customer_id FROM portal_sessions WHERE hash=$1 AND expires_at>now()", digest(cookie.Value)).Scan(&customer)
	return customer
}
func (s *Server) auth(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		reply(w, 405, map[string]string{"message": "Método indisponível."})
		return
	}
	if r.URL.Path == "/auth/logout" {
		if cookie, e := r.Cookie("portal_session"); e == nil {
			if _, e = s.DB.ExecContext(r.Context(), "DELETE FROM portal_sessions WHERE hash=$1", digest(cookie.Value)); e != nil {
				reply(w, 503, map[string]string{"message": "Não foi possível terminar a sessão."})
				return
			}
		}
		s.sessionCookie(w, "", -1)
		reply(w, 200, map[string]bool{"ok": true})
		return
	}
	var in struct {
		Code     string `json:"code"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !read(w, r, &in) || len(in.Password) < 12 || len(in.Password) > 256 || len(in.Email) > 254 {
		reply(w, 400, map[string]string{"message": "Verifique o email e a palavra-passe (12 a 256 caracteres)."})
		return
	}
	email := strings.ToLower(strings.TrimSpace(in.Email))
	if !regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`).MatchString(email) {
		reply(w, 400, map[string]string{"message": "Email inválido."})
		return
	}
	if !s.authAttempt(r.Context(), "global-login", 100) || !s.authAttempt(r.Context(), "email:"+email, 5) {
		reply(w, 429, map[string]string{"message": "Demasiadas tentativas. Aguarde 15 minutos."})
		return
	}
	var customer string
	if r.URL.Path == "/auth/activate" {
		if len(in.Code) != 48 || s.DB.QueryRowContext(r.Context(), "SELECT id FROM portal_customers WHERE access_hash=$1 AND password_hash IS NULL", digest(in.Code)).Scan(&customer) != nil {
			reply(w, 401, map[string]string{"message": "Código de ativação inválido ou já utilizado."})
			return
		}
		result, e := s.DB.ExecContext(r.Context(), "UPDATE portal_customers SET email=$2,password_hash=$3,access_hash=$4 WHERE id=$1 AND password_hash IS NULL", customer, email, passwordHash(in.Password), digest(ID()))
		if e != nil {
			reply(w, 409, map[string]string{"message": "Não foi possível ativar a conta com estes dados."})
			return
		}
		n, _ := result.RowsAffected()
		if n != 1 {
			reply(w, 409, map[string]string{"message": "Conta já ativada."})
			return
		}
	} else {
		var stored string
		_ = s.DB.QueryRowContext(r.Context(), "SELECT id,password_hash FROM portal_customers WHERE email=$1 AND email_verified", email).Scan(&customer, &stored)
		if !passwordMatches(in.Password, stored) || customer == "" {
			reply(w, 401, map[string]string{"message": "Email ou palavra-passe inválidos."})
			return
		}
	}
	session := ID()
	if _, e := s.DB.ExecContext(r.Context(), "INSERT INTO portal_sessions VALUES ($1,$2,$3)", digest(session), customer, time.Now().Add(8*time.Hour)); e != nil {
		reply(w, 503, map[string]string{"message": "Não foi possível iniciar a sessão. Tente entrar novamente."})
		return
	}
	s.sessionCookie(w, session, 28800)
	reply(w, 200, map[string]bool{"ok": true})
}
