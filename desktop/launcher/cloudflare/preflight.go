package cloudflare

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
)

type HostingReport struct {
	Paid      bool      `json:"paid"`
	D1        bool      `json:"d1"`
	R2        bool      `json:"r2"`
	Workers   bool      `json:"workers"`
	CheckedAt time.Time `json:"checkedAt"`
}
type HostingError struct {
	Code    string
	Message string
}

func (e *HostingError) Error() string           { return e.Message }
func hostingFailure(code, message string) error { return &HostingError{Code: code, Message: message} }

// InspectHosting is read-only. A positive result verifies current billing state
// and read access; write permissions and runtime CPU still require deployment tests.
func (c *Client) InspectHosting(ctx context.Context, account string) (HostingReport, error) {
	report := HostingReport{CheckedAt: time.Now().UTC()}
	if !accountID.MatchString(account) {
		return report, hostingFailure("INVALID_ACCOUNT", "Selecione uma conta Cloudflare válida.")
	}
	var subscriptions []struct {
		State string `json:"state"`
		Plan  struct {
			ID string `json:"id"`
		} `json:"rate_plan"`
	}
	if _, e := c.request(ctx, http.MethodGet, "/accounts/"+account+"/subscriptions", nil, &subscriptions); e != nil {
		var apiError *APIError
		if errors.As(e, &apiError) && (apiError.Status == 401 || apiError.Status == 403) {
			return report, hostingFailure("BILLING_ACCESS_REQUIRED", "Falta permissão de leitura da faturação para confirmar Workers Paid. Autorize o acesso e volte a verificar.")
		}
		return report, hostingFailure("BILLING_UNAVAILABLE", "Não foi possível confirmar o plano Cloudflare. Volte a verificar mais tarde.")
	}
	for _, subscription := range subscriptions {
		if strings.EqualFold(subscription.Plan.ID, "WORKERS_PAID") && (subscription.State == "Paid" || subscription.State == "Provisioned") {
			report.Paid = true
		}
	}
	if !report.Paid {
		return report, hostingFailure("WORKERS_PAID_REQUIRED", "Não foi confirmada uma subscrição Workers Paid ativa. Ative o plano ou peça ao operador para verificar um contrato diferente.")
	}
	var databases []Database
	if _, e := c.request(ctx, http.MethodGet, "/accounts/"+account+"/d1/database?per_page=1", nil, &databases); e != nil {
		return report, hostingFailure("D1_UNAVAILABLE", "Não foi possível consultar D1. Verifique as permissões da conta.")
	}
	report.D1 = true
	var buckets struct {
		Buckets []Bucket `json:"buckets"`
	}
	if _, e := c.request(ctx, http.MethodGet, "/accounts/"+account+"/r2/buckets?per_page=1", nil, &buckets); e != nil {
		return report, hostingFailure("R2_UNAVAILABLE", "Não foi possível consultar R2. Verifique a ativação e as permissões.")
	}
	report.R2 = true
	var workers []struct {
		ID string `json:"id"`
	}
	if _, e := c.request(ctx, http.MethodGet, "/accounts/"+account+"/workers/scripts", nil, &workers); e != nil {
		return report, hostingFailure("WORKERS_UNAVAILABLE", "Não foi possível consultar Workers. Verifique as permissões.")
	}
	report.Workers = true
	return report, nil
}
