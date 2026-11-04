package cloudflare

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestProvisionFromJournalResumesAcrossInvocations(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	account := strings.Repeat("a", 32)
	first := &provisioningFake{bucketError: &APIError{Status: 403}}
	started, err := provisionFromJournal(ctx, first, dir, account)
	if err == nil || started.DatabaseID == "" {
		t.Fatalf("expected saved database and rejected bucket: %+v, %v", started, err)
	}
	second := &provisioningFake{}
	if _, err := provisionFromJournal(ctx, second, dir, strings.Repeat("b", 32)); err == nil {
		t.Fatal("journal accepted a different Cloudflare account")
	}
	completed, err := provisionFromJournal(ctx, second, dir, account)
	if err != nil || completed.Name != started.Name || completed.DatabaseID != started.DatabaseID || completed.BucketName == "" {
		t.Fatalf("unexpected resume: %+v, %v", completed, err)
	}
	if second.databaseCalls != 0 || second.bucketCalls != 1 {
		t.Fatalf("unexpected mutations on resume: %+v", second)
	}
}

func TestProvisionFromJournalHonorsExistingLock(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "provision.lock"), 0700); err != nil {
		t.Fatal(err)
	}
	client := &provisioningFake{}
	_, err := provisionFromJournal(context.Background(), client, dir, strings.Repeat("a", 32))
	if err == nil || client.databaseCalls != 0 || client.bucketCalls != 0 {
		t.Fatalf("existing deployment lock was ignored: %v", err)
	}
}
