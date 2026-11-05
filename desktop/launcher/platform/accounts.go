package platform

import (
	"context"
	"encoding/json"
	"errors"
	"foodtruck.local/desktop/cloudflare"
	"net/http"
	"regexp"
)

var accountPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)
var ErrAuthorization = errors.New("Cloudflare authorization missing or expired")

func (s *Server) customerToken(ctx context.Context, customer string) (string, error) {
	var encrypted []byte
	// Reserve enough lifetime for the complete deployment operation.
	if s.DB.QueryRowContext(ctx, "SELECT token FROM portal_oauth_tokens WHERE customer_id=$1 AND expires_at>now()+interval '15 minutes'", customer).Scan(&encrypted) != nil {
		return "", ErrAuthorization
	}
	raw, e := Open(s.Key, encrypted, customer)
	if e != nil {
		return "", ErrAuthorization
	}
	defer func() {
		for i := range raw {
			raw[i] = 0
		}
	}()
	var token struct {
		AccessToken string `json:"access_token"`
	}
	if json.Unmarshal(raw, &token) != nil || token.AccessToken == "" {
		return "", ErrAuthorization
	}
	return token.AccessToken, nil
}
func (s *Server) accountList(ctx context.Context, token string) ([]cloudflare.Account, error) {
	if s.Accounts != nil {
		return s.Accounts(ctx, token)
	}
	return cloudflare.New(token).Accounts(ctx)
}
func (s *Server) accounts(w http.ResponseWriter, r *http.Request, customer string) {
	token, e := s.customerToken(r.Context(), customer)
	if e != nil {
		reply(w, 409, map[string]string{"message": "Ligue novamente a conta Cloudflare. A autorização está ausente ou próxima de expirar."})
		return
	}
	accounts, e := s.accountList(r.Context(), token)
	if e != nil {
		reply(w, 409, map[string]string{"message": "Não foi possível consultar contas. Verifique a autorização e as permissões."})
		return
	}
	reply(w, 200, accounts)
}

// JobCredentials resolves the owner from the persisted job, never from browser input.
func (s *Server) JobCredentials(ctx context.Context, id string) (account, token string, customerHosted bool, err error) {
	var customer, mode string
	err = s.DB.QueryRowContext(ctx, "SELECT o.customer_id,o.mode,o.account_id FROM portal_orders o JOIN portal_jobs j ON j.order_id=o.id WHERE j.id=$1 AND o.active_until>now()", id).Scan(&customer, &mode, &account)
	if err != nil {
		return
	}
	customerHosted = mode == "customer"
	if !customerHosted {
		return
	}
	if !accountPattern.MatchString(account) {
		err = ErrAuthorization
		return
	}
	token, err = s.customerToken(ctx, customer)
	if err != nil {
		return
	}
	accounts, e := s.accountList(ctx, token)
	if e != nil {
		err = ErrAuthorization
		return
	}
	for _, a := range accounts {
		if a.ID == account {
			return
		}
	}
	err = ErrAuthorization
	return
}
