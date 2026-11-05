package main

import (
	"bufio"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"foodtruck.local/desktop/cloudflare"
	"io"
	"os"
	"time"
)

type request struct {
	Action           string          `json:"action"`
	Token            string          `json:"token"`
	PackageDirectory string          `json:"packageDirectory"`
	Account          string          `json:"account"`
	License          json.RawMessage `json:"license"`
	JournalDirectory string          `json:"journalDirectory"`
	Business         json.RawMessage `json:"business"`
	CostsApproved    bool            `json:"costsApproved"`
	ImagesApproved   bool            `json:"imagesApproved"`
}

// Supplied at release build time. Distribution never includes the private key.
var vendorPublicKey string

func execute(ctx context.Context, input request) (any, error) {
	switch input.Action {
	case "accounts":
		if len(input.Token) < 20 || len(input.Token) > 512 {
			return nil, errors.New("Indique um token Cloudflare válido.")
		}
		return cloudflare.New(input.Token).Accounts(ctx)
	case "verify-package":
		if input.PackageDirectory == "" {
			return nil, errors.New("Escolha o pacote da aplicação.")
		}
		return cloudflare.VerifyDeploymentPackage(input.PackageDirectory)
	case "verify-license", "install":
		public, err := base64.RawURLEncoding.Strict().DecodeString(vendorPublicKey)
		if err != nil || len(public) != ed25519.PublicKeySize {
			return nil, errors.New("A chave pública de distribuição ainda não foi configurada.")
		}
		if input.Action == "verify-license" {
			return cloudflare.VerifyLicense(input.License, ed25519.PublicKey(public), input.Account)
		}
		if len(input.Token) < 20 || len(input.Token) > 512 || input.JournalDirectory == "" {
			return nil, errors.New("Dados de instalação inválidos.")
		}
		return cloudflare.New(input.Token).InstallApplication(ctx, input.JournalDirectory, input.PackageDirectory,
			input.Account, cloudflare.InstallOptions{Business: input.Business, License: input.License,
				PublicKey: ed25519.PublicKey(public), CostsApproved: input.CostsApproved, ImagesApproved: input.ImagesApproved})
	default:
		return nil, errors.New("Operação indisponível.")
	}
}

// One JSON request per process, over stdin. stdout contains only the response.
func run(input io.Reader, output io.Writer) error {
	reader := bufio.NewReader(io.LimitReader(input, 65537))
	line, err := reader.ReadBytes('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return err
	}
	response := map[string]any{}
	var message request
	if len(line) > 65536 || json.Unmarshal(line, &message) != nil {
		response["error"] = "Pedido de instalação inválido."
	} else {
		timeout := 90 * time.Second
		if message.Action == "install" {
			timeout = 10 * time.Minute
		}
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()
		result, err := execute(ctx, message)
		if err != nil {
			response["error"] = "Não foi possível concluir a operação. Verifique o token, as permissões e o pacote selecionado."
		} else {
			response["result"] = result
		}
	}
	return json.NewEncoder(output).Encode(response)
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "Não foi possível comunicar com o assistente.")
		os.Exit(1)
	}
}
