package platform

import (
	"errors"
	"foodtruck.local/desktop/cloudflare"
	"net/http"
)

func (s *Server) hostingCheck(w http.ResponseWriter, r *http.Request, customer string) {
	var in struct {
		Order   string `json:"order"`
		Account string `json:"account"`
	}
	if !read(w, r, &in) {
		reply(w, 400, map[string]string{"message": "Dados inválidos."})
		return
	}
	var mode, recorded string
	if s.DB.QueryRowContext(r.Context(), "SELECT mode,account_id FROM portal_orders WHERE id=$1 AND customer_id=$2 AND active_until>now()", in.Order, customer).Scan(&mode, &recorded) != nil {
		reply(w, 404, map[string]string{"message": "Compra indisponível."})
		return
	}
	account, token := s.PlatformAccount, s.PlatformToken
	if mode == "customer" {
		if !accountPattern.MatchString(in.Account) || (recorded != "" && recorded != in.Account) {
			reply(w, 409, map[string]string{"message": "Selecione a conta associada à instalação."})
			return
		}
		var e error
		token, e = s.customerToken(r.Context(), customer)
		if e != nil {
			reply(w, 409, map[string]string{"message": "Ligue novamente a conta Cloudflare."})
			return
		}
		accounts, e := s.accountList(r.Context(), token)
		allowed := false
		for _, a := range accounts {
			if a.ID == in.Account {
				allowed = true
			}
		}
		if e != nil || !allowed {
			reply(w, 403, map[string]string{"message": "Conta não autorizada."})
			return
		}
		account = in.Account
	}
	report, e := cloudflare.New(token).InspectHosting(r.Context(), account)
	if e != nil {
		var failure *cloudflare.HostingError
		if errors.As(e, &failure) {
			reply(w, 409, map[string]any{"code": failure.Code, "message": failure.Message, "report": report})
			return
		}
		reply(w, 503, map[string]string{"message": "Não foi possível verificar o alojamento."})
		return
	}
	reply(w, 200, map[string]any{"message": "Workers Paid confirmado. D1, R2 e Workers acessíveis para leitura. A publicação validará as operações de escrita.", "report": report})
}
