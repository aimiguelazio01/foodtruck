package cloudflare

import (
	"context"
	"crypto/ed25519"
	"errors"
	"net/http"
	"regexp"
)

type MigrationSpec struct {
	Name   string `json:"name"`
	SHA256 string `json:"sha256"`
}
type DatabaseSchema struct {
	Minimum    int             `json:"minimum"`
	Maximum    int             `json:"maximum"`
	Migrations []MigrationSpec `json:"migrations"`
}

func validateSchemaContract(schema DatabaseSchema) error {
	if schema.Minimum < 1 || schema.Maximum < schema.Minimum || schema.Maximum > len(schema.Migrations) || len(schema.Migrations) > 10000 {
		return errors.New("invalid package schema compatibility range")
	}
	names := map[string]bool{}
	namePattern := regexp.MustCompile(`^[0-9]{3}_[a-z_]+$`)
	hashPattern := regexp.MustCompile(`^[a-f0-9]{64}$`)
	for _, migration := range schema.Migrations {
		if !namePattern.MatchString(migration.Name) || !hashPattern.MatchString(migration.SHA256) || names[migration.Name] {
			return errors.New("invalid package migration identity")
		}
		names[migration.Name] = true
	}
	return nil
}

func (c *Client) verifyRestoredSchema(ctx context.Context, account, database string, schema DatabaseSchema) error {
	if e := validateSchemaContract(schema); e != nil {
		return e
	}
	var result []struct {
		Success bool `json:"success"`
		Results []struct {
			Sequence int    `json:"sequence"`
			Name     string `json:"name"`
			SHA256   string `json:"sha256"`
		} `json:"results"`
	}
	if _, e := c.request(ctx, http.MethodPost, "/accounts/"+account+"/d1/database/"+database+"/query", map[string]any{"sql": "SELECT sequence,name,sha256 FROM foodtruck_schema_migrations ORDER BY sequence", "params": []any{}}, &result); e != nil {
		return e
	}
	if len(result) != 1 || !result[0].Success {
		return errors.New("restored migration ledger unavailable")
	}
	rows := result[0].Results
	if len(rows) < schema.Minimum || len(rows) > schema.Maximum {
		return errors.New("backup schema is outside the package compatibility range")
	}
	for i, row := range rows {
		expected := schema.Migrations[i]
		if row.Sequence != i+1 || row.Name != expected.Name || row.SHA256 != expected.SHA256 {
			return errors.New("backup migration history does not match signed package")
		}
	}
	return nil
}

func (c *Client) ValidateBackupAgainstPackage(ctx context.Context, directory, account, id, packageDirectory string, key ed25519.PublicKey, sql []byte, checksum string, state RestoreCopy, save func(RestoreCopy) error) (RestoreCopy, error) {
	manifest, e := VerifySignedDeploymentPackage(packageDirectory, key)
	if e != nil {
		return state, e
	}
	if e = validateSchemaContract(manifest.Schema); e != nil {
		return state, e
	}
	for _, migration := range manifest.Schema.Migrations {
		file, exists := manifest.Files["migrations/"+migration.Name+".sql"]
		if !exists || file.SHA256 != migration.SHA256 {
			return state, errors.New("package migration inventory mismatch")
		}
	}
	if state.PackageVersion != "" && state.PackageVersion != manifest.Version {
		return state, errors.New("restore package changed; operator recovery required")
	}
	state.PackageVersion = manifest.Version
	if e = save(state); e != nil {
		return state, e
	}
	return c.validateBackupCopy(ctx, directory, account, id, sql, checksum, state, save, &manifest.Schema)
}
