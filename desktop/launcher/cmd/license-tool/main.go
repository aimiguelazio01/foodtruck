package main

import (
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"foodtruck.local/desktop/cloudflare"
	"os"
	"path/filepath"
)

func writeNew(path string, data []byte) error {
	if path == "" {
		return errors.New("indique o caminho do ficheiro de saída")
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	_, writeErr := file.Write(data)
	return errors.Join(writeErr, file.Close())
}

func generate(privatePath, publicPath string) error {
	if privatePath == publicPath || privatePath == "" || publicPath == "" {
		return errors.New("indique caminhos diferentes para as duas chaves")
	}
	public, private, err := ed25519.GenerateKey(nil)
	if err != nil {
		return err
	}
	encoded, err := x509.MarshalPKCS8PrivateKey(private)
	if err != nil {
		return err
	}
	if err := writeNew(privatePath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: encoded})); err != nil {
		return err
	}
	return writeNew(publicPath, []byte(base64.RawURLEncoding.EncodeToString(public)+"\n"))
}

func readPrivateKey(privatePath string) (ed25519.PrivateKey, error) {
	data, err := os.ReadFile(privatePath)
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode(data)
	if block == nil || block.Type != "PRIVATE KEY" {
		return nil, errors.New("chave privada inválida")
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	private, ok := key.(ed25519.PrivateKey)
	if !ok {
		return nil, errors.New("a chave deve ser Ed25519")
	}
	return private, nil
}

func issue(privatePath, account, order, output string) error {
	if order == "" || len(order) > 250 {
		return errors.New("indique o identificador da compra")
	}
	private, err := readPrivateKey(privatePath)
	if err != nil {
		return err
	}
	claims := cloudflare.License{Version: 1, Product: "food-truck-live", Account: account, OrderID: order}
	payload, err := json.Marshal(claims)
	if err != nil {
		return err
	}
	document, err := json.MarshalIndent(map[string]string{"payload": base64.RawURLEncoding.EncodeToString(payload),
		"signature": base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, payload))}, "", "  ")
	if err != nil {
		return err
	}
	if _, err := cloudflare.VerifyLicense(document, private.Public().(ed25519.PublicKey), account); err != nil {
		return err
	}
	return writeNew(output, append(document, '\n'))
}

func signPackage(privatePath, directory string) error {
	if _, err := cloudflare.VerifyDeploymentPackage(directory); err != nil {
		return err
	}
	private, err := readPrivateKey(privatePath)
	if err != nil {
		return err
	}
	manifest, err := os.ReadFile(filepath.Join(directory, "manifest.json"))
	if err != nil {
		return err
	}
	signature := ed25519.Sign(private, cloudflare.DeploymentSigningMessage(manifest))
	return writeNew(filepath.Join(directory, "manifest.signature"), []byte(base64.RawURLEncoding.EncodeToString(signature)+"\n"))
}

func main() {
	mode := flag.String("mode", "", "generate, issue ou sign-package")
	packageDir := flag.String("package", "", "pasta do pacote a assinar")
	private := flag.String("private-key", "", "ficheiro privado PKCS8 PEM, exclusivo do vendedor")
	public := flag.String("public-key", "", "ficheiro público base64url para a distribuição")
	account := flag.String("account", "", "identificador da conta Cloudflare do comprador")
	order := flag.String("order", "", "identificador da compra")
	output := flag.String("out", "", "licença a criar")
	flag.Parse()
	var err error
	switch *mode {
	case "generate":
		err = generate(*private, *public)
	case "issue":
		err = issue(*private, *account, *order, *output)
	case "sign-package":
		err = signPackage(*private, *packageDir)
	default:
		err = errors.New("escolha -mode generate, issue ou sign-package")
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
