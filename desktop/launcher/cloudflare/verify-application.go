package cloudflare

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func (c *Client) verifyApplication(ctx context.Context, addresses ApplicationAddresses) error {
	return c.verifyApplicationAt(ctx, addresses, ".workers.dev")
}

// verifyWithRetry waits for a freshly attached hostname to start answering over HTTPS.
func verifyWithRetry(ctx context.Context, wait bool, verify func() error) error {
	attempts := 1
	if wait {
		attempts = domainVerifyAttempts
	}
	var err error
	for i := 0; i < attempts; i++ {
		if err = verify(); err == nil {
			return nil
		}
		if i+1 < attempts {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(domainVerifyDelay):
			}
		}
	}
	return err
}

func (c *Client) verifyApplicationAt(ctx context.Context, addresses ApplicationAddresses, suffix string) error {
	for _, address := range []string{addresses.Customer, addresses.Management} {
		origin, err := url.Parse(address)
		if err != nil || origin.Scheme != "https" || origin.User != nil || origin.Path != "" || origin.RawQuery != "" ||
			!strings.HasSuffix(origin.Host, suffix) {
			return errors.New("Invalid application verification address")
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, address+"/api/v1/installation/status", nil)
		if err != nil {
			return err
		}
		response, err := c.http.Do(request)
		if err != nil {
			return errors.New("The application is not yet reachable. Resume to retry verification")
		}
		var status struct {
			Configured *bool `json:"configured"`
			Demo       *bool `json:"demo"`
			ReadOnly   *bool `json:"readOnly"`
		}
		decodeErr := json.NewDecoder(io.LimitReader(response.Body, 8192)).Decode(&status)
		response.Body.Close()
		if response.StatusCode != 200 || decodeErr != nil || status.Configured == nil || !*status.Configured ||
			status.Demo == nil || *status.Demo || status.ReadOnly == nil || *status.ReadOnly {
			return errors.New("Application installation status could not be verified")
		}
		request, err = http.NewRequestWithContext(ctx, http.MethodGet, address+"/", nil)
		if err != nil {
			return err
		}
		response, err = c.http.Do(request)
		if err != nil {
			return errors.New("Application homepage is not yet reachable")
		}
		_, readErr := io.Copy(io.Discard, io.LimitReader(response.Body, 65536))
		response.Body.Close()
		if response.StatusCode != 200 || !strings.HasPrefix(response.Header.Get("Content-Type"), "text/html") || readErr != nil {
			return errors.New("Application homepage could not be verified")
		}
	}
	return nil
}
