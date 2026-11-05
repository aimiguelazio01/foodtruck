package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"foodtruck.local/desktop/cloudflare"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// demoToken is derived from the signing key, so a later run can load the data again without storing another secret.
func demoToken(private ed25519.PrivateKey) string {
	mac := hmac.New(sha256.New, private.Seed())
	_, _ = mac.Write([]byte("foodtruck-demo-token-v1"))
	return hex.EncodeToString(mac.Sum(nil))
}

// demoInstallCommand installs the shared demonstration site once, with `platform -demo-install -env <file>`.
// Run it from the repository root: it needs deployment/demo/build-seed-package.mjs and Node.
func demoInstallCommand(args []string) (exit int, handled bool) {
	if len(args) == 0 || args[0] != "-demo-install" {
		return 0, false
	}
	if len(args) != 3 || args[1] != "-env" {
		fmt.Fprintln(os.Stderr, "Utilização: platform -demo-install -env <ficheiro .env>")
		return 2, true
	}
	if err := loadEnvFile(args[2]); err != nil {
		fmt.Fprintln(os.Stderr, "Não foi possível ler o ficheiro .env")
		return 2, true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	addresses, err := installDemo(ctx, os.Getenv, os.Stdout)
	if err != nil {
		fmt.Fprintln(os.Stderr, "✘ Demonstração:", err)
		return 1, true
	}
	if err := appendEnv(args[2], map[string]string{"PLATFORM_DEMO_CUSTOMER_URL": addresses.Customer, "PLATFORM_DEMO_MANAGEMENT_URL": addresses.Management}); err != nil {
		fmt.Fprintln(os.Stderr, "! Não foi possível gravar os endereços no .env:", err)
	}
	fmt.Fprintln(os.Stdout, "✔ Demonstração pronta")
	fmt.Fprintln(os.Stdout, "  Site do cliente:", addresses.Customer)
	fmt.Fprintln(os.Stdout, "  Gestão:         ", addresses.Management)
	return 0, true
}

func installDemo(ctx context.Context, env func(string) string, out io.Writer) (cloudflare.ApplicationAddresses, error) {
	var none cloudflare.ApplicationAddresses
	account, token := env("PLATFORM_CLOUDFLARE_ACCOUNT"), env("PLATFORM_CLOUDFLARE_TOKEN")
	if account == "" || len(token) < 20 {
		return none, errors.New("faltam PLATFORM_CLOUDFLARE_ACCOUNT e PLATFORM_CLOUDFLARE_TOKEN")
	}
	if env("PLATFORM_HOSTING_APPROVED") != "true" {
		return none, errors.New("PLATFORM_HOSTING_APPROVED tem de ser true: a instalação cria recursos reais na Cloudflare")
	}
	raw, err := base64.RawURLEncoding.DecodeString(env("PLATFORM_SIGNING_KEY"))
	if err != nil || len(raw) != ed25519.PrivateKeySize {
		return none, errors.New("PLATFORM_SIGNING_KEY em falta ou inválida")
	}
	private := ed25519.PrivateKey(raw)
	packageDirectory := env("PLATFORM_PACKAGE_HOST_PATH")
	if packageDirectory == "" {
		packageDirectory = env("PLATFORM_PACKAGE_DIRECTORY")
	}
	if packageDirectory == "" {
		return none, errors.New("falta PLATFORM_PACKAGE_HOST_PATH (pasta do pacote assinado)")
	}
	journals := env("PLATFORM_DEMO_JOURNAL_DIRECTORY")
	if journals == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return none, err
		}
		journals = filepath.Join(home, ".foodtruck-platform", "demo-journal")
	}
	password := make([]byte, 24)
	if _, err := rand.Read(password); err != nil {
		return none, err
	}
	// The setup account is only needed to create the first business; nobody signs in with it.
	business, _ := json.Marshal(map[string]string{"email": "setup@demo.invalid", "password": hex.EncodeToString(password), "name": "Demonstração",
		"address": "", "phone": "", "contactEmail": "", "primaryColor": "#ed8735", "secondaryColor": "#20271f"})
	payload, _ := json.Marshal(cloudflare.License{Version: 1, Product: "food-truck-live", Account: account, OrderID: "demo"})
	license, _ := json.Marshal(map[string]string{"payload": base64.RawURLEncoding.EncodeToString(payload),
		"signature": base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, payload))})
	client := cloudflare.New(token)
	if _, err := client.InspectHosting(ctx, account); err != nil {
		return none, fmt.Errorf("a conta Cloudflare não está pronta: %w", err)
	}
	fmt.Fprintln(out, "… A instalar o site de demonstração na Cloudflare (2 a 5 minutos)")
	addresses, err := client.InstallPilot(ctx, journals, packageDirectory, account, "demo", cloudflare.InstallOptions{
		Business: business, License: license, PublicKey: private.Public().(ed25519.PublicKey), CostsApproved: true,
		Demo: true, DemoToken: demoToken(private),
		Progress: func(step string) error { fmt.Fprintln(out, "   ·", step); return nil },
	})
	if err != nil {
		return none, err
	}
	fmt.Fprintln(out, "… A carregar os dados de exemplo")
	if err := loadDemoData(ctx, addresses.Management, demoToken(private), out); err != nil {
		return addresses, err
	}
	return addresses, nil
}

// loadDemoData builds the seed package with Node (fixture + the real D1 columns) and sends it to the demonstration.
func loadDemoData(ctx context.Context, management, token string, out io.Writer) error {
	file := filepath.Join(os.TempDir(), fmt.Sprintf("foodtruck-demo-seed-%d.json", time.Now().UnixNano()))
	defer os.Remove(file)
	build := exec.CommandContext(ctx, "node", filepath.Join("deployment", "demo", "build-seed-package.mjs"), file)
	if output, err := build.CombinedOutput(); err != nil {
		return fmt.Errorf("não foi possível preparar os dados (corra a partir da pasta do projeto, com o Node instalado): %s", strings.TrimSpace(string(output)))
	}
	body, err := os.ReadFile(file)
	if err != nil {
		return err
	}
	return putDemoSeed(ctx, http.DefaultClient, management, token, body, out)
}

func putDemoSeed(ctx context.Context, client *http.Client, management, token string, body []byte, out io.Writer) error {
	var last error
	// A new Worker can take a moment to answer: try a few times before giving up.
	for attempt := 1; attempt <= 6; attempt++ {
		request, err := http.NewRequestWithContext(ctx, http.MethodPut, management+"/api/v1/demo/seed", bytes.NewReader(body))
		if err != nil {
			return err
		}
		request.Header.Set("x-demo-token", token)
		request.Header.Set("Content-Type", "application/json")
		response, err := client.Do(request)
		if err == nil {
			answer, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
			response.Body.Close()
			if response.StatusCode == http.StatusOK {
				fmt.Fprintln(out, "   ·", strings.TrimSpace(string(answer)))
				return nil
			}
			last = fmt.Errorf("a demonstração respondeu HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(answer)))
			if response.StatusCode == http.StatusForbidden || response.StatusCode == http.StatusBadRequest {
				return last
			}
		} else {
			last = err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(10 * time.Second):
		}
	}
	return last
}

// appendEnv sets or adds non-secret KEY=value lines.
func appendEnv(path string, values map[string]string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	lines := strings.Split(string(data), "\n")
	for key, value := range values {
		found := false
		for index, line := range lines {
			if strings.HasPrefix(line, key+"=") {
				lines[index], found = key+"="+value, true
			}
		}
		if !found {
			lines = append(lines, key+"="+value)
		}
	}
	return os.WriteFile(path, []byte(strings.Join(lines, "\n")), 0o600)
}
