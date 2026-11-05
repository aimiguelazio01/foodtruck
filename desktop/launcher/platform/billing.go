package platform

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	stripeBase       = "https://api.stripe.com"
	webhookTolerance = 5 * time.Minute
	// Payment providers retry failed charges for days; keep the site up that long past the paid period.
	paidGrace = 3 * 24 * time.Hour
)

func (s *Server) billingReady() bool {
	return s.StripeKey != "" && s.StripePrice != "" && strings.HasPrefix(s.Origin, "https://")
}

func (s *Server) stripeCall(ctx context.Context, path string, form url.Values, out any) error {
	base := s.StripeBase
	if base == "" {
		base = stripeBase
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, base+path, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+s.StripeKey)
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Idempotency-Key", ID())
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		return errors.New("payment provider unavailable")
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if response.StatusCode != 200 {
		return errors.New("payment provider rejected the request")
	}
	return json.Unmarshal(body, out)
}

// billing starts Stripe Checkout (subscribe) or the Stripe customer portal (card, invoices, cancel).
func (s *Server) billing(w http.ResponseWriter, r *http.Request, customer string) {
	if !s.billingReady() {
		reply(w, 503, map[string]string{"message": "Os pagamentos ainda não estão disponíveis."})
		return
	}
	var in struct {
		Order string `json:"order"`
	}
	if !read(w, r, &in) {
		reply(w, 400, map[string]string{"message": "Pedido inválido."})
		return
	}
	var email, stripeCustomer string
	var status string
	e := s.DB.QueryRowContext(r.Context(), `SELECT coalesce(c.email,''),coalesce(o.stripe_customer_id,''),o.plan_status
		FROM portal_orders o JOIN portal_customers c ON c.id=o.customer_id
		WHERE o.id=$1 AND o.customer_id=$2 AND o.mode='platform'`, in.Order, customer).Scan(&email, &stripeCustomer, &status)
	if e != nil {
		reply(w, 404, map[string]string{"message": "Subscrição indisponível."})
		return
	}
	var out struct {
		URL string `json:"url"`
	}
	if r.URL.Path == "/billing/portal" {
		if stripeCustomer == "" {
			reply(w, 409, map[string]string{"message": "Ainda não existe uma subscrição para gerir."})
			return
		}
		e = s.stripeCall(r.Context(), "/v1/billing_portal/sessions", url.Values{"customer": {stripeCustomer}, "return_url": {s.Origin + "/"}}, &out)
	} else {
		if status == "active" || status == "past_due" {
			reply(w, 409, map[string]string{"message": "A subscrição já está ativa. Use a gestão de pagamento."})
			return
		}
		form := url.Values{
			"mode": {"subscription"}, "client_reference_id": {in.Order},
			"line_items[0][price]": {s.StripePrice}, "line_items[0][quantity]": {"1"},
			"subscription_data[metadata][order]": {in.Order},
			"success_url":                        {s.Origin + "/?billing=ok"}, "cancel_url": {s.Origin + "/?billing=cancelled"},
		}
		if stripeCustomer != "" {
			form.Set("customer", stripeCustomer)
		} else if email != "" {
			form.Set("customer_email", email)
		}
		e = s.stripeCall(r.Context(), "/v1/checkout/sessions", form, &out)
	}
	if e != nil || out.URL == "" {
		reply(w, 502, map[string]string{"message": "Não foi possível abrir o pagamento. Tente novamente."})
		return
	}
	reply(w, 200, map[string]string{"url": out.URL})
}

// verifyStripeSignature checks the Stripe-Signature header (t=<unix>,v1=<hmac>) against the raw body.
func verifyStripeSignature(secret string, header string, body []byte, now time.Time) bool {
	if secret == "" {
		return false
	}
	var stamp string
	var signatures []string
	for _, part := range strings.Split(header, ",") {
		key, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			continue
		}
		switch key {
		case "t":
			stamp = value
		case "v1":
			signatures = append(signatures, value)
		}
	}
	seconds, err := strconv.ParseInt(stamp, 10, 64)
	if err != nil || len(signatures) == 0 {
		return false
	}
	age := now.Sub(time.Unix(seconds, 0))
	if age > webhookTolerance || age < -webhookTolerance {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(stamp + "."))
	mac.Write(body)
	expected := mac.Sum(nil)
	for _, signature := range signatures {
		if given, err := hex.DecodeString(signature); err == nil && hmac.Equal(given, expected) {
			return true
		}
	}
	return false
}

type stripeEvent struct {
	ID   string `json:"id"`
	Type string `json:"type"`
	Data struct {
		Object json.RawMessage `json:"object"`
	} `json:"data"`
}

// stripeWebhook is called by Stripe only. It is idempotent per event ID: the event record and its
// effect commit together, so a failure is retried by Stripe and a duplicate delivery is a no-op.
func (s *Server) stripeWebhook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil || !verifyStripeSignature(s.StripeSecret, r.Header.Get("Stripe-Signature"), body, time.Now()) {
		reply(w, 400, map[string]string{"message": "Assinatura inválida."})
		return
	}
	var event stripeEvent
	if json.Unmarshal(body, &event) != nil || event.ID == "" {
		reply(w, 400, map[string]string{"message": "Evento inválido."})
		return
	}
	tx, err := s.DB.BeginTx(r.Context(), nil)
	if err != nil {
		reply(w, 503, map[string]string{"message": "Serviço indisponível."})
		return
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(r.Context(), "INSERT INTO portal_stripe_events(id) VALUES ($1) ON CONFLICT DO NOTHING", event.ID)
	if err != nil {
		reply(w, 503, map[string]string{"message": "Serviço indisponível."})
		return
	}
	if n, _ := result.RowsAffected(); n == 0 {
		reply(w, 200, map[string]bool{"duplicate": true})
		return
	}
	if err = s.applyStripeEvent(r.Context(), tx, event); err != nil {
		reply(w, 500, map[string]string{"message": "Evento não processado."})
		return
	}
	if err = tx.Commit(); err != nil {
		reply(w, 503, map[string]string{"message": "Serviço indisponível."})
		return
	}
	reply(w, 200, map[string]bool{"ok": true})
}

type orderRef struct {
	Metadata struct {
		Order string `json:"order"`
	} `json:"metadata"`
}

func (s *Server) applyStripeEvent(ctx context.Context, tx *sql.Tx, event stripeEvent) error {
	switch event.Type {
	case "checkout.session.completed":
		var object struct {
			Order        string `json:"client_reference_id"`
			Customer     string `json:"customer"`
			Subscription string `json:"subscription"`
			Mode         string `json:"mode"`
		}
		if json.Unmarshal(event.Data.Object, &object) != nil {
			return errors.New("bad checkout session")
		}
		if object.Mode != "subscription" || object.Order == "" {
			return nil
		}
		// Records the Stripe identifiers; the paid period itself comes from invoice.paid.
		_, err := tx.ExecContext(ctx, "UPDATE portal_orders SET stripe_customer_id=$2,stripe_subscription_id=$3 WHERE id=$1 AND mode='platform'", object.Order, object.Customer, object.Subscription)
		return err
	case "invoice.paid":
		var object struct {
			Customer     string   `json:"customer"`
			Subscription string   `json:"subscription"`
			Details      orderRef `json:"subscription_details"`
			Parent       struct {
				Details struct {
					Subscription string `json:"subscription"`
					orderRef
				} `json:"subscription_details"`
			} `json:"parent"`
			Lines struct {
				Data []struct {
					Period struct {
						End int64 `json:"end"`
					} `json:"period"`
				} `json:"data"`
			} `json:"lines"`
		}
		if json.Unmarshal(event.Data.Object, &object) != nil {
			return errors.New("bad invoice")
		}
		subscription := object.Subscription
		if subscription == "" {
			subscription = object.Parent.Details.Subscription
		}
		order := object.Details.Metadata.Order
		if order == "" {
			order = object.Parent.Details.Metadata.Order
		}
		var end int64
		for _, line := range object.Lines.Data {
			if line.Period.End > end {
				end = line.Period.End
			}
		}
		if (subscription == "" && order == "") || end == 0 {
			return nil // not a subscription invoice
		}
		result, err := tx.ExecContext(ctx, `UPDATE portal_orders SET stripe_customer_id=$3,stripe_subscription_id=$4,plan_status='active',simulated=false,suspended_at=NULL,
			teardown_state=CASE WHEN teardown_state='queued' THEN '' ELSE teardown_state END,
			active_until=GREATEST(active_until,to_timestamp($5::double precision)+make_interval(secs => $6::double precision))
			WHERE mode='platform' AND (stripe_subscription_id=$2 OR id=$1)`,
			order, subscription, object.Customer, subscription, end, paidGrace.Seconds())
		if err != nil {
			return err
		}
		if n, _ := result.RowsAffected(); n == 0 {
			// Our order is unknown (yet). Make Stripe retry rather than losing a payment.
			return errors.New("order for paid invoice not found")
		}
		return nil
	case "invoice.payment_failed":
		var object struct {
			Subscription string `json:"subscription"`
			Parent       struct {
				Details struct {
					Subscription string `json:"subscription"`
				} `json:"subscription_details"`
			} `json:"parent"`
		}
		if json.Unmarshal(event.Data.Object, &object) != nil {
			return errors.New("bad invoice")
		}
		subscription := object.Subscription
		if subscription == "" {
			subscription = object.Parent.Details.Subscription
		}
		if subscription == "" {
			return nil
		}
		// active_until is not touched: the site stays up until the paid period plus grace ends.
		_, err := tx.ExecContext(ctx, "UPDATE portal_orders SET plan_status='past_due' WHERE stripe_subscription_id=$1 AND plan_status='active'", subscription)
		return err
	case "customer.subscription.updated", "customer.subscription.deleted":
		var object struct {
			ID                string `json:"id"`
			CancelAtPeriodEnd bool   `json:"cancel_at_period_end"`
			Status            string `json:"status"`
		}
		if json.Unmarshal(event.Data.Object, &object) != nil || object.ID == "" {
			return errors.New("bad subscription")
		}
		status := "active"
		switch {
		case event.Type == "customer.subscription.deleted" || object.Status == "canceled" || object.Status == "incomplete_expired":
			status = "canceled"
		case object.Status == "past_due" || object.Status == "unpaid":
			status = "past_due"
		}
		_, err := tx.ExecContext(ctx, `UPDATE portal_orders SET cancel_requested=$2,
			plan_status=CASE WHEN $3::text='active' AND plan_status IN ('trialing','suspended') THEN plan_status ELSE $3::text END
			WHERE stripe_subscription_id=$1`, object.ID, object.CancelAtPeriodEnd, status)
		return err
	}
	return nil
}
