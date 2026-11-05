CREATE TABLE IF NOT EXISTS portal_customers (
 id text PRIMARY KEY, name text NOT NULL, access_hash text UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS portal_orders (
 id text PRIMARY KEY, customer_id text NOT NULL REFERENCES portal_customers,
 mode text NOT NULL CHECK(mode IN ('platform','customer')),
 active_until timestamptz NOT NULL, simulated boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS portal_jobs (
 id text PRIMARY KEY, order_id text NOT NULL UNIQUE REFERENCES portal_orders,
 state text NOT NULL CHECK(state IN ('queued','running','blocked','ready','cancelled')),
 payload bytea, result jsonb, message text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS portal_audit (
 id text PRIMARY KEY, actor text NOT NULL, action text NOT NULL,
 target text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS portal_oauth_states (
 hash text PRIMARY KEY, customer_id text NOT NULL REFERENCES portal_customers,
 verifier bytea NOT NULL, browser_hash text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS portal_oauth_tokens (
 customer_id text PRIMARY KEY REFERENCES portal_customers,
 token bytea NOT NULL, expires_at timestamptz NOT NULL
);
ALTER TABLE portal_orders ADD COLUMN IF NOT EXISTS account_id text NOT NULL DEFAULT '';
ALTER TABLE portal_orders ADD COLUMN IF NOT EXISTS cancel_requested boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS portal_hosting_grants (
 order_id text PRIMARY KEY REFERENCES portal_orders,
 token_hash text UNIQUE NOT NULL, token bytea NOT NULL
);
CREATE TABLE IF NOT EXISTS portal_backups (
 id text PRIMARY KEY, job_id text NOT NULL REFERENCES portal_jobs,
 state text NOT NULL CHECK(state IN ('queued','running','failed','ready')),
 payload bytea, sha256 text, bookmark text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS portal_backup_in_progress ON portal_backups(job_id) WHERE state IN ('queued','running');
CREATE TABLE IF NOT EXISTS portal_restore_checks (
 id text PRIMARY KEY, backup_id text UNIQUE NOT NULL REFERENCES portal_backups,
 state text NOT NULL CHECK(state IN ('queued','running','failed','verified')),
 progress jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE portal_customers ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS portal_email_tokens (
 hash text PRIMARY KEY, customer_id text NOT NULL REFERENCES portal_customers, expires_at timestamptz NOT NULL
);
ALTER TABLE portal_orders ADD COLUMN IF NOT EXISTS plan_status text NOT NULL DEFAULT 'active' CHECK(plan_status IN ('trialing','active','past_due','canceled','suspended'));
ALTER TABLE portal_orders ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
ALTER TABLE portal_orders ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE portal_orders ADD COLUMN IF NOT EXISTS stripe_subscription_id text UNIQUE;
CREATE TABLE IF NOT EXISTS portal_stripe_events (
 id text PRIMARY KEY, received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE portal_orders ADD COLUMN IF NOT EXISTS trial_reminder_3 timestamptz;
ALTER TABLE portal_orders ADD COLUMN IF NOT EXISTS trial_reminder_1 timestamptz;
ALTER TABLE portal_orders ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
ALTER TABLE portal_orders ADD COLUMN IF NOT EXISTS teardown_state text NOT NULL DEFAULT '' CHECK(teardown_state IN ('','queued','running','done'));
ALTER TABLE portal_orders ADD COLUMN IF NOT EXISTS teardown_retry_at timestamptz;
CREATE TABLE IF NOT EXISTS portal_slugs (
 slug text PRIMARY KEY, order_id text NOT NULL UNIQUE REFERENCES portal_orders, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE portal_jobs ADD COLUMN IF NOT EXISTS step text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS portal_backup_grants (
 job_id text PRIMARY KEY REFERENCES portal_jobs, token bytea NOT NULL
);
ALTER TABLE portal_backups ADD COLUMN IF NOT EXISTS include_media boolean NOT NULL DEFAULT false;
ALTER TABLE portal_backups ADD COLUMN IF NOT EXISTS media_payload bytea;
ALTER TABLE portal_backups ADD COLUMN IF NOT EXISTS media_sha256 text;
ALTER TABLE portal_customers ADD COLUMN IF NOT EXISTS email text UNIQUE;
ALTER TABLE portal_customers ADD COLUMN IF NOT EXISTS password_hash text;
CREATE TABLE IF NOT EXISTS portal_sessions (
 hash text PRIMARY KEY, customer_id text NOT NULL REFERENCES portal_customers,
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS portal_auth_limits (
 key text PRIMARY KEY, attempts integer NOT NULL, reset_at timestamptz NOT NULL
);
