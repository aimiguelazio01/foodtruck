package cloudflare

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"path"
	"regexp"
	"strings"
)

var modulePath = regexp.MustCompile(`^[a-zA-Z0-9_./@-]+$`)

// UploadSiteWorker joins an asset session to the Worker upload. The caller
// verifies ownership of the named Worker before performing either operation.
func (c *Client) UploadSiteWorker(ctx context.Context, account, name string, metadata json.RawMessage, modules []WorkerModule, files map[string][]byte) error {
	var config map[string]json.RawMessage
	if json.Unmarshal(metadata, &config) != nil || config == nil {
		return errors.New("Invalid site Worker metadata")
	}
	jwt, err := c.UploadAssets(ctx, account, name, files)
	if err != nil {
		return err
	}
	config["assets"], err = json.Marshal(map[string]any{"jwt": jwt, "config": map[string]any{
		"run_worker_first": []string{"/api/v1/*", "/uploads/*"},
	}})
	if err != nil {
		return err
	}
	encoded, err := json.Marshal(config)
	if err != nil {
		return err
	}
	return c.UploadWorker(ctx, account, name, encoded, modules)
}

type WorkerModule struct {
	Name    string
	Content []byte
}

// UploadWorker is a low-level operation that replaces a script with the same
// name. The deployment caller must verify resource ownership before calling it.
func (c *Client) UploadWorker(ctx context.Context, account, name string, metadata json.RawMessage, modules []WorkerModule) error {
	if !accountID.MatchString(account) || !resourceName.MatchString(name) {
		return errors.New("Invalid Cloudflare account or Worker name")
	}
	var config struct {
		Main string `json:"main_module"`
	}
	if json.Unmarshal(metadata, &config) != nil || config.Main == "" || len(metadata) > 1<<20 || len(modules) == 0 || len(modules) > 1000 {
		return errors.New("Invalid Worker metadata or module list")
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	writePart := func(field, filename, contentType string, content []byte) error {
		disposition := map[string]string{"name": field}
		if filename != "" {
			disposition["filename"] = filename
		}
		header := make(textproto.MIMEHeader)
		header.Set("Content-Disposition", mime.FormatMediaType("form-data", disposition))
		header.Set("Content-Type", contentType)
		part, err := writer.CreatePart(header)
		if err != nil {
			return err
		}
		_, err = part.Write(content)
		return err
	}
	if err := writePart("metadata", "", "application/json", metadata); err != nil {
		return err
	}
	seen := make(map[string]bool)
	for _, module := range modules {
		if !modulePath.MatchString(module.Name) || path.Clean(module.Name) != module.Name || strings.HasPrefix(module.Name, "/") ||
			module.Name == ".." || strings.HasPrefix(module.Name, "../") || seen[module.Name] || len(module.Content) > (32<<20)-body.Len() {
			return errors.New("Invalid or oversized Worker module")
		}
		kind := "application/javascript+module"
		switch path.Ext(module.Name) {
		case ".js", ".mjs":
		case ".wasm":
			kind = "application/wasm"
		default:
			return errors.New("Unsupported Worker module type")
		}
		seen[module.Name] = true
		if err := writePart(module.Name, module.Name, kind, module.Content); err != nil {
			return err
		}
	}
	if !seen[config.Main] || (path.Ext(config.Main) != ".js" && path.Ext(config.Main) != ".mjs") {
		return errors.New("Worker entrypoint module is missing")
	}
	if err := writer.Close(); err != nil {
		return err
	}
	_, err := c.send(ctx, http.MethodPut, "/accounts/"+account+"/workers/scripts/"+name, &body, writer.FormDataContentType(), nil)
	return err
}
