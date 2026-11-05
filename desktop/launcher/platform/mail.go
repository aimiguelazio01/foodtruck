package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"time"
)

// MailReady reports whether the platform can send email, either through a test hook or Brevo.
func (s *Server) MailReady() bool {
	if s.Mail != nil {
		return true
	}
	_, ok := s.sender()
	return ok && s.BrevoKey != ""
}

func (s *Server) sender() (mail.Address, bool) {
	address, err := mail.ParseAddress(s.MailFrom)
	if err != nil {
		return mail.Address{}, false
	}
	if address.Name == "" {
		address.Name = "Food Truck Live"
	}
	return *address, true
}

// sendMail delivers plain-text email through Brevo's HTTPS API. It never logs addresses or bodies.
func (s *Server) sendMail(ctx context.Context, to, subject, text string) error {
	if s.Mail != nil {
		return s.Mail(ctx, to, subject, text)
	}
	from, ok := s.sender()
	if !ok || s.BrevoKey == "" {
		return errors.New("email is not configured")
	}
	payload, err := json.Marshal(map[string]any{
		"sender": map[string]string{"email": from.Address, "name": from.Name},
		"to":     []map[string]string{{"email": to}}, "subject": subject, "textContent": text,
	})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.brevo.com/v3/smtp/email", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("api-key", s.BrevoKey)
	request.Header.Set("Content-Type", "application/json")
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		return errors.New("email delivery failed")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return errors.New("email delivery failed")
	}
	return nil
}
