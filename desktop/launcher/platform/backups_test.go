package platform

import (
	"bytes"
	"context"
	"database/sql"
	"foodtruck.local/desktop/cloudflare"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestBackupQueueIsolationAndEncryption(t *testing.T) {
	if os.Getenv("DATABASE_URL") == "" {
		t.Skip("isolated PostgreSQL required")
	}
	db, e := sql.Open("pgx", os.Getenv("DATABASE_URL"))
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	if _, e = db.Exec(Schema); e != nil {
		t.Fatal(e)
	}
	s := &Server{DB: db, Key: bytes.Repeat([]byte{5}, 32)}
	customer, order, job := ID(), ID(), ID()
	if _, e = db.Exec("INSERT INTO portal_customers VALUES ($1,'backup-test',$2)", customer, ID()); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("INSERT INTO portal_orders(id,customer_id,mode,active_until) VALUES ($1,$2,'platform',now()+interval '1 day')", order, customer); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("INSERT INTO portal_jobs(id,order_id,state) VALUES ($1,$2,'ready')", job, order); e != nil {
		t.Fatal(e)
	}
	call := func(owner string) int {
		r := httptest.NewRequest("POST", "/backups", strings.NewReader(`{"order":"`+order+`"}`))
		w := httptest.NewRecorder()
		s.backups(w, r, owner)
		return w.Code
	}
	if call(ID()) != 404 {
		t.Fatal("foreign backup accepted")
	}
	if call(customer) != 202 || call(customer) != 202 {
		t.Fatal("enqueue failed")
	}
	runs := 0
	export := func(_ context.Context, id string) (cloudflare.SQLBackup, error) {
		runs++
		if id != job {
			t.Fatal("wrong installation")
		}
		return cloudflare.SQLBackup{SQL: []byte("CREATE TABLE test(id TEXT);"), SHA256: "checksum", Bookmark: "bookmark"}, nil
	}
	if e = s.RunBackupOne(context.Background(), export); e != nil {
		t.Fatal(e)
	}
	if e = s.RunBackupOne(context.Background(), export); e != nil || runs != 1 {
		t.Fatal("duplicate backup")
	}
	var id, state string
	var data []byte
	if db.QueryRow("SELECT id,state,payload FROM portal_backups WHERE job_id=$1", job).Scan(&id, &state, &data) != nil || state != "ready" {
		t.Fatal("backup not stored")
	}
	if bytes.Contains(data, []byte("CREATE TABLE")) {
		t.Fatal("plaintext backup")
	}
	clear, e := Open(s.Key, data, id)
	if e != nil || string(clear) != "CREATE TABLE test(id TEXT);" {
		t.Fatal("encrypted backup cannot be read")
	}
	requestCheck := func(owner string) int {
		r := httptest.NewRequest("POST", "/restores", strings.NewReader(`{"backup":"`+id+`","costsApproved":true}`))
		w := httptest.NewRecorder()
		s.restores(w, r, owner)
		return w.Code
	}
	if requestCheck(ID()) != 409 {
		t.Fatal("foreign restore accepted")
	}
	if requestCheck(customer) != 202 || requestCheck(customer) != 409 {
		t.Fatal("duplicate validation accepted")
	}
	validations := 0
	validator := func(_ context.Context, source, restore string, sql []byte, hash string, state cloudflare.RestoreCopy, save func(cloudflare.RestoreCopy) error) (cloudflare.RestoreCopy, error) {
		validations++
		if source != job || string(sql) != "CREATE TABLE test(id TEXT);" {
			t.Fatal("wrong backup decrypted")
		}
		state.DatabaseID = "isolated-copy"
		state.Imported = true
		state.Verified = true
		return state, save(state)
	}
	if e = s.RunRestoreOne(context.Background(), validator); e != nil {
		t.Fatal(e)
	}
	if e = s.RunRestoreOne(context.Background(), validator); e != nil || validations != 1 {
		t.Fatal("validation repeated")
	}
	var validationState string
	if db.QueryRow("SELECT state FROM portal_restore_checks WHERE backup_id=$1", id).Scan(&validationState) != nil || validationState != "verified" {
		t.Fatal("validation not recorded")
	}

	r := httptest.NewRequest("POST", "/backups", strings.NewReader(`{"order":"`+order+`","includeMedia":true}`))
	w := httptest.NewRecorder()
	s.backups(w, r, customer)
	if w.Code != 202 {
		t.Fatal("media backup enqueue failed")
	}
	var mediaBackup string
	if db.QueryRow("SELECT id FROM portal_backups WHERE job_id=$1 AND state='queued' AND include_media", job).Scan(&mediaBackup) != nil {
		t.Fatal("media consent not persisted")
	}
	if e = s.RunBackupOne(context.Background(), func(ctx context.Context, source string) (cloudflare.SQLBackup, error) {
		include, err := s.BackupMediaRequested(ctx, source)
		if err != nil || !include {
			t.Fatal("media consent missing")
		}
		return cloudflare.SQLBackup{SQL: []byte("SQL"), SHA256: "test", Media: map[string][]byte{"uploads/12345678-1234-1234-1234-123456789abc.webp": []byte("image")}}, nil
	}); e != nil {
		t.Fatal(e)
	}
	var media []byte
	if db.QueryRow("SELECT media_payload FROM portal_backups WHERE id=$1 AND state='ready'", mediaBackup).Scan(&media) != nil || len(media) == 0 {
		t.Fatal("media backup not stored")
	}
	raw, err := Open(s.Key, media, mediaBackup+":media")
	if err != nil || !bytes.Contains(raw, []byte("checksums")) {
		t.Fatal("media archive unreadable")
	}

	s.RestoreImages = func(_ context.Context, source, restore string, files map[string][]byte, state cloudflare.RestoreCopy, save func(cloudflare.RestoreCopy) error) (cloudflare.RestoreCopy, error) {
		if source != job || string(files["uploads/12345678-1234-1234-1234-123456789abc.webp"]) != "image" {
			t.Fatal("wrong restored images")
		}
		state.MediaBucket = "isolated-images"
		state.MediaVerified = true
		state.MediaWorkerDeleted = true
		return state, save(state)
	}
	request := httptest.NewRequest("POST", "/restores", strings.NewReader(`{"backup":"`+mediaBackup+`","costsApproved":true}`))
	out := httptest.NewRecorder()
	s.restores(out, request, customer)
	if out.Code != 202 {
		t.Fatal("media restore enqueue failed")
	}
	sqlChecks := 0
	validateSQL := func(_ context.Context, source, restore string, data []byte, checksum string, state cloudflare.RestoreCopy, save func(cloudflare.RestoreCopy) error) (cloudflare.RestoreCopy, error) {
		sqlChecks++
		state.Verified = true
		state.DatabaseID = "isolated-sql"
		return state, save(state)
	}
	if e = s.RunRestoreOne(context.Background(), validateSQL); e != nil {
		t.Fatal(e)
	}
	if db.QueryRow("SELECT state FROM portal_restore_checks WHERE backup_id=$1", mediaBackup).Scan(&validationState) != nil || validationState != "verified" || sqlChecks != 1 {
		t.Fatal("combined restore not verified")
	}
	if _, e = db.Exec("UPDATE portal_restore_checks SET state='queued' WHERE backup_id=$1", mediaBackup); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("UPDATE portal_backups SET media_sha256='tampered' WHERE id=$1", mediaBackup); e != nil {
		t.Fatal(e)
	}
	if e = s.RunRestoreOne(context.Background(), validateSQL); e != nil {
		t.Fatal(e)
	}
	if sqlChecks != 1 {
		t.Fatal("tampered archive reached cloud operations")
	}

}
