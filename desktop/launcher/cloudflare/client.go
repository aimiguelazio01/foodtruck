package cloudflare

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const api = "https://api.cloudflare.com/client/v4"

var accountID = regexp.MustCompile(`^[0-9a-f]{32}$`)
var resourceName = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$`)

type Client struct {
	token string
	http  *http.Client
}

func New(token string) *Client {
	return &Client{token: strings.TrimSpace(token), http: &http.Client{
		Timeout:       30 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

type APIError struct {
	Status int
	Code   int
	// A mutation must be reconciled before retry when the outcome is unknown.
	OutcomeUnknown bool
}

func (e *APIError) Error() string {
	return fmt.Sprintf("Cloudflare request failed (HTTP %d, code %d)", e.Status, e.Code)
}

type envelope struct {
	Success bool            `json:"success"`
	Result  json.RawMessage `json:"result"`
	Errors  []struct {
		Code int `json:"code"`
	} `json:"errors"`
	Info struct {
		TotalPages int `json:"total_pages"`
	} `json:"result_info"`
}

func (c *Client) request(ctx context.Context, method, path string, body, result any) (envelope, error) {
	var data io.Reader
	var contentType string
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return envelope{}, err
		}
		data = bytes.NewReader(encoded)
		contentType = "application/json"
	}
	return c.send(ctx, method, path, data, contentType, result)
}

func (c *Client) send(ctx context.Context, method, path string, data io.Reader, contentType string, result any) (envelope, error) {
	var reply envelope
	if c.token == "" {
		return reply, errors.New("Cloudflare API token is required")
	}
	req, err := http.NewRequestWithContext(ctx, method, api+path, data)
	if err != nil {
		return reply, errors.New("Invalid Cloudflare request")
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return reply, &APIError{OutcomeUnknown: method != http.MethodGet}
	}
	defer resp.Body.Close()
	decodeErr := json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&reply)
	if decodeErr != nil || !reply.Success || resp.StatusCode < 200 || resp.StatusCode >= 300 {
		failure := &APIError{Status: resp.StatusCode, OutcomeUnknown: method != http.MethodGet &&
			(resp.StatusCode >= 500 || resp.StatusCode == 408 || resp.StatusCode >= 200 && resp.StatusCode < 300)}
		if len(reply.Errors) > 0 {
			failure.Code = reply.Errors[0].Code
		}
		return reply, failure
	}
	if result != nil && json.Unmarshal(reply.Result, result) != nil {
		return reply, &APIError{Status: resp.StatusCode, OutcomeUnknown: method != http.MethodGet}
	}
	return reply, nil
}

type Account struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type Database struct {
	ID   string `json:"uuid"`
	Name string `json:"name"`
}
type Bucket struct {
	Name string `json:"name"`
}

func (c *Client) Accounts(ctx context.Context) ([]Account, error) {
	var accounts []Account
	for page := 1; page <= 100; page++ {
		var items []Account
		reply, err := c.request(ctx, http.MethodGet, fmt.Sprintf("/accounts?page=%d&per_page=50", page), nil, &items)
		if err != nil {
			return nil, err
		}
		accounts = append(accounts, items...)
		if page >= reply.Info.TotalPages {
			return accounts, nil
		}
	}
	return nil, errors.New("Cloudflare account list exceeds the supported size")
}

func (c *Client) FindDatabase(ctx context.Context, account, name string) (*Database, error) {
	if !accountID.MatchString(account) || !resourceName.MatchString(name) {
		return nil, errors.New("Invalid account or database name")
	}
	for page := 1; page <= 100; page++ {
		var items []Database
		reply, err := c.request(ctx, http.MethodGet, fmt.Sprintf("/accounts/%s/d1/database?name=%s&page=%d", account, url.QueryEscape(name), page), nil, &items)
		if err != nil {
			return nil, err
		}
		for _, item := range items {
			if item.Name == name {
				return &item, nil
			}
		}
		if page >= reply.Info.TotalPages {
			return nil, nil
		}
	}
	return nil, errors.New("Cloudflare database list exceeds the supported size")
}

func (c *Client) CreateDatabase(ctx context.Context, account, name string) (Database, error) {
	var result Database
	if !accountID.MatchString(account) || !resourceName.MatchString(name) {
		return result, errors.New("Invalid account or database name")
	}
	_, err := c.request(ctx, http.MethodPost, "/accounts/"+account+"/d1/database", map[string]string{"name": name}, &result)
	if err == nil && (result.ID == "" || result.Name != name) {
		err = &APIError{Status: 200, OutcomeUnknown: true}
	}
	return result, err
}

func (c *Client) CreateBucket(ctx context.Context, account, name string) (Bucket, error) {
	var result Bucket
	if !accountID.MatchString(account) || !resourceName.MatchString(name) {
		return result, errors.New("Invalid account or bucket name")
	}
	_, err := c.request(ctx, http.MethodPost, "/accounts/"+account+"/r2/buckets", map[string]string{"name": name, "storageClass": "Standard"}, &result)
	if err == nil && result.Name != name {
		err = &APIError{Status: 200, OutcomeUnknown: true}
	}
	return result, err
}
