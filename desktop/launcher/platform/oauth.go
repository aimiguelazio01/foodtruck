package platform

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type OAuthConfig struct {
	ClientID, ClientSecret, Scopes string
	HTTP                           *http.Client
}

func (s *Server) oauthStart(w http.ResponseWriter, r *http.Request, customer string) {
	if s.OAuth.ClientID == "" || s.OAuth.Scopes == "" {
		reply(w, 503, map[string]string{"message": "O operador ainda precisa de configurar o cliente OAuth Cloudflare."})
		return
	}
	state, verifier, browser := ID(), ID(), ID()
	encrypted, e := Seal(s.Key, []byte(verifier), state)
	if e == nil {
		_, e = s.DB.ExecContext(r.Context(), "INSERT INTO portal_oauth_states VALUES ($1,$2,$3,$4,now()+interval '10 minutes')", digest(state), customer, encrypted, digest(browser))
	}
	if e != nil {
		reply(w, 503, map[string]string{"message": "Não foi possível iniciar a autorização."})
		return
	}
	challenge := sha256.Sum256([]byte(verifier))
	q := url.Values{"client_id": {s.OAuth.ClientID}, "redirect_uri": {s.Origin + "/api/oauth/callback"}, "response_type": {"code"}, "scope": {s.OAuth.Scopes}, "state": {state}, "code_challenge": {base64.RawURLEncoding.EncodeToString(challenge[:])}, "code_challenge_method": {"S256"}}
	http.SetCookie(w, &http.Cookie{Name: "portal_oauth", Value: browser, HttpOnly: true, Secure: strings.HasPrefix(s.Origin, "https://"), SameSite: http.SameSiteLaxMode, Path: "/api/oauth/callback", MaxAge: 600})
	reply(w, 200, map[string]string{"url": "https://dash.cloudflare.com/oauth2/auth?" + q.Encode()})
}
func (s *Server) oauthCallback(w http.ResponseWriter, r *http.Request) {
	fail := func() {
		reply(w, 400, map[string]string{"message": "Autorização inválida ou expirada. Volte ao portal e tente novamente."})
	}
	state, code := r.URL.Query().Get("state"), r.URL.Query().Get("code")
	cookie, e := r.Cookie("portal_oauth")
	if e != nil || len(state) != 48 || len(code) == 0 || len(code) > 4096 || s.OAuth.ClientID == "" {
		fail()
		return
	}
	var customer string
	var encrypted []byte
	// Consume atomically so a callback cannot be replayed, including concurrent requests.
	e = s.DB.QueryRowContext(r.Context(), "DELETE FROM portal_oauth_states WHERE hash=$1 AND browser_hash=$2 AND expires_at>now() RETURNING customer_id,verifier", digest(state), digest(cookie.Value)).Scan(&customer, &encrypted)
	if e != nil {
		fail()
		return
	}
	verifier, e := Open(s.Key, encrypted, state)
	if e != nil {
		fail()
		return
	}
	defer func() {
		for i := range verifier {
			verifier[i] = 0
		}
	}()
	form := url.Values{"grant_type": {"authorization_code"}, "code": {code}, "client_id": {s.OAuth.ClientID}, "redirect_uri": {s.Origin + "/api/oauth/callback"}, "code_verifier": {string(verifier)}}
	request, e := http.NewRequestWithContext(r.Context(), http.MethodPost, "https://dash.cloudflare.com/oauth2/token", strings.NewReader(form.Encode()))
	if e != nil {
		fail()
		return
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if s.OAuth.ClientSecret != "" {
		request.SetBasicAuth(s.OAuth.ClientID, s.OAuth.ClientSecret)
	}
	client := s.OAuth.HTTP
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	response, e := client.Do(request)
	if e != nil {
		fail()
		return
	}
	defer response.Body.Close()
	raw, e := io.ReadAll(io.LimitReader(response.Body, 16385))
	if e != nil || len(raw) > 16384 || response.StatusCode != 200 {
		fail()
		return
	}
	var token struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		ExpiresIn   int64  `json:"expires_in"`
	}
	if json.NewDecoder(bytes.NewReader(raw)).Decode(&token) != nil || token.AccessToken == "" || !strings.EqualFold(token.TokenType, "bearer") || token.ExpiresIn <= 0 || token.ExpiresIn > 86400*365 {
		fail()
		return
	}
	encrypted, e = Seal(s.Key, raw, customer)
	if e == nil {
		_, e = s.DB.ExecContext(r.Context(), "INSERT INTO portal_oauth_tokens VALUES ($1,$2,$3) ON CONFLICT(customer_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at", customer, encrypted, time.Now().Add(time.Duration(token.ExpiresIn)*time.Second))
	}
	if e != nil {
		fail()
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "portal_oauth", Value: "", Path: "/api/oauth/callback", HttpOnly: true, Secure: strings.HasPrefix(s.Origin, "https://"), SameSite: http.SameSiteLaxMode, MaxAge: -1})
	http.Redirect(w, r, s.Origin+"/?cloudflare=connected", http.StatusSeeOther)
}
