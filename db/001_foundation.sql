-- Initial tenant-scoped foundation. Apply to an empty PostgreSQL database.
BEGIN;
CREATE TABLE businesses (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  timezone text NOT NULL DEFAULT 'Europe/Lisbon',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
  business_id uuid NOT NULL REFERENCES businesses(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('owner','manager','staff')),
  PRIMARY KEY (business_id,user_id)
);
CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE TABLE categories (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  display_order integer NOT NULL DEFAULT 0,
  UNIQUE (business_id,id),
  UNIQUE (business_id,name)
);
CREATE TABLE products (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id),
  category_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  description text NOT NULL DEFAULT '',
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  availability text NOT NULL DEFAULT 'available' CHECK (availability IN ('available','limited','sold_out','unavailable')),
  UNIQUE (business_id,id),
  FOREIGN KEY (business_id,category_id) REFERENCES categories(business_id,id)
);
CREATE INDEX products_business_category_idx ON products(business_id,category_id);
COMMIT;
