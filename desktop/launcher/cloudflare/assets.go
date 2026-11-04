package cloudflare

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io/fs"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"path"
	"strings"
)

type assetEntry struct {
	Hash string `json:"hash"`
	Size int    `json:"size"`
}

// UploadAssets returns an ephemeral completion token for the Worker upload.
func (c *Client) UploadAssets(ctx context.Context, account, worker string, files map[string][]byte) (string, error) {
	if !accountID.MatchString(account) || !resourceName.MatchString(worker) || len(files) == 0 {
		return "", errors.New("Invalid account, Worker or asset list")
	}
	manifest := make(map[string]assetEntry, len(files))
	byHash := make(map[string]string, len(files))
	for name, data := range files {
		if name == "." || !fs.ValidPath(name) || strings.ContainsAny(name, "\\?#\x00") || len(data) > 25<<20 {
			return "", errors.New("Invalid asset path or size")
		}
		digest := sha256.New()
		encoder := base64.NewEncoder(base64.StdEncoding, digest)
		_, _ = encoder.Write(data)
		_ = encoder.Close()
		_, _ = digest.Write([]byte(strings.TrimPrefix(path.Ext(name), ".")))
		hash := hex.EncodeToString(digest.Sum(nil)[:16])
		manifest["/"+name] = assetEntry{Hash: hash, Size: len(data)}
		byHash[hash] = name
	}
	var session struct {
		JWT     string     `json:"jwt"`
		Buckets [][]string `json:"buckets"`
	}
	_, err := c.request(ctx, http.MethodPost, "/accounts/"+account+"/workers/scripts/"+worker+"/assets-upload-session",
		map[string]any{"manifest": manifest}, &session)
	if err != nil {
		return "", err
	}
	if session.JWT == "" {
		return "", errors.New("Missing asset session token")
	}
	if len(session.Buckets) == 0 {
		return session.JWT, nil
	}
	for _, bucket := range session.Buckets {
		for _, hash := range bucket {
			if _, ok := byHash[hash]; !ok {
				return "", errors.New("Cloudflare requested an unknown asset")
			}
		}
	}
	var completion string
	sessionClient := &Client{token: session.JWT, http: c.http}
	for _, bucket := range session.Buckets {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		for _, hash := range bucket {
			name := byHash[hash]
			header := make(textproto.MIMEHeader)
			header.Set("Content-Disposition", mime.FormatMediaType("form-data", map[string]string{"name": hash, "filename": hash}))
			kind := mime.TypeByExtension(path.Ext(name))
			if kind == "" {
				kind = "application/octet-stream"
			}
			header.Set("Content-Type", kind)
			part, err := writer.CreatePart(header)
			if err != nil {
				return "", err
			}
			encoder := base64.NewEncoder(base64.StdEncoding, part)
			_, err = encoder.Write(files[name])
			if err = errors.Join(err, encoder.Close()); err != nil {
				return "", err
			}
		}
		if err := writer.Close(); err != nil {
			return "", err
		}
		var result struct {
			JWT string `json:"jwt"`
		}
		if _, err := sessionClient.send(ctx, http.MethodPost, "/accounts/"+account+"/workers/assets/upload?base64=true",
			&body, writer.FormDataContentType(), &result); err != nil {
			return "", err
		}
		if result.JWT != "" {
			completion = result.JWT
		}
	}
	if completion == "" {
		return "", errors.New("Cloudflare did not confirm asset upload completion")
	}
	return completion, nil
}
