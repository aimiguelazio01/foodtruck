package cloudflare

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type provisioningFake struct {
	databaseCalls int
	bucketCalls   int
	bucketError   error
}

func (*provisioningFake) FindDatabase(context.Context, string, string) (*Database, error) {
	return nil, nil
}
func (f *provisioningFake) CreateDatabase(_ context.Context, _, name string) (Database, error) {
	f.databaseCalls++
	return Database{ID: "database-id", Name: name}, nil
}
func (f *provisioningFake) CreateBucket(_ context.Context, _, name string) (Bucket, error) {
	f.bucketCalls++
	return Bucket{Name: name}, f.bucketError
}

func TestProvisionResumesAfterRejectedBucketCreation(t *testing.T) {
	state, err := NewProvisionState(strings.Repeat("a", 32))
	if err != nil {
		t.Fatal(err)
	}
	client := &provisioningFake{bucketError: &APIError{Status: 403}}
	journal := state
	save := func(next ProvisionState) error { journal = next; return nil }
	result, err := Provision(context.Background(), client, state, save)
	if err == nil || result.DatabaseID != journal.DatabaseID || journal.DatabaseID == "" || journal.Pending != "" {
		t.Fatalf("expected database recorded and bucket retryable: %+v, %v", journal, err)
	}
	client.bucketError = nil
	result, err = Provision(context.Background(), client, journal, save)
	if err != nil || result.BucketName != state.Name || client.databaseCalls != 1 || client.bucketCalls != 2 {
		t.Fatalf("unexpected resume: %+v, %v", result, err)
	}
}

func TestProvisionStopsOnUncertainOutcomeOrFailedJournalWrite(t *testing.T) {
	state, err := NewProvisionState(strings.Repeat("a", 32))
	if err != nil {
		t.Fatal(err)
	}
	client := &provisioningFake{bucketError: &APIError{OutcomeUnknown: true}}
	_, err = Provision(context.Background(), client, state, func(ProvisionState) error { return errors.New("disk unavailable") })
	if err == nil || client.databaseCalls != 0 {
		t.Fatal("mutation attempted before saving its intent")
	}
	journal := state
	save := func(next ProvisionState) error { journal = next; return nil }
	_, err = Provision(context.Background(), client, state, save)
	if err == nil || journal.Pending != "R2 bucket" {
		t.Fatalf("uncertain outcome was not recorded: %+v", journal)
	}
	_, err = Provision(context.Background(), client, journal, save)
	if err == nil || client.bucketCalls != 1 {
		t.Fatal("uncertain creation was retried")
	}
}
