package main

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"foodtruck.local/desktop/cloudflare"
)

type purchase struct {
	ID               string          `json:"id"`
	Account          string          `json:"account"`
	PackageDirectory string          `json:"packageDirectory"`
	JournalDirectory string          `json:"journalDirectory"`
	Business         json.RawMessage `json:"business"`
	License          json.RawMessage `json:"license"`
	CostsApproved    bool            `json:"costsApproved"`
}

func run() error {
	input, err := io.ReadAll(io.LimitReader(os.Stdin, 65537))
	if err != nil {
		return err
	}
	var event purchase
	if len(input) > 65536 || json.Unmarshal(input, &event) != nil {
		return errors.New("Evento de compra inválido")
	}
	if !event.CostsApproved {
		return errors.New("O piloto requer autorização para criar recursos na Cloudflare")
	}
	token := strings.TrimSpace(os.Getenv("CLOUDFLARE_API_TOKEN"))
	if token == "" {
		return errors.New("Falta acesso autorizado à conta Cloudflare do piloto")
	}
	key, err := base64.RawURLEncoding.Strict().DecodeString(strings.TrimSpace(os.Getenv("FOODTRUCK_LICENSE_PUBLIC_KEY")))
	if err != nil || len(key) != ed25519.PublicKeySize {
		return errors.New("Falta a chave pública do pacote do piloto")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	result, err := cloudflare.New(token).InstallPilot(ctx, event.JournalDirectory, event.PackageDirectory, event.Account, event.ID,
		cloudflare.InstallOptions{Business: event.Business, License: event.License, PublicKey: ed25519.PublicKey(key), CostsApproved: event.CostsApproved})
	if err != nil {
		if diagnostic, diagnosticErr := cloudflare.New(token).DiagnoseBootstrap(ctx,
			filepath.Join(event.JournalDirectory, fmt.Sprintf("%x", sha256.Sum256([]byte(event.Account+"\n"+event.ID)))), event.Account); diagnosticErr == nil {
			if data, encodeErr := json.Marshal(diagnostic); encodeErr == nil {
				fmt.Fprintln(os.Stderr, "Diagnostico:", string(data))
			}
		} else {
			fmt.Fprintln(os.Stderr, "Diagnostico indisponivel:", diagnosticErr)
		}
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(result)
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
