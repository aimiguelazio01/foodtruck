CREATE TABLE IF NOT EXISTS customers(id text PRIMARY KEY,email text UNIQUE NOT NULL,password text NOT NULL,verified_at integer,created_at integer NOT NULL);
CREATE TABLE IF NOT EXISTS customer_sessions(hash text PRIMARY KEY,customer_id text NOT NULL REFERENCES customers(id),expires integer NOT NULL);
CREATE TABLE IF NOT EXISTS customer_verifications(hash text PRIMARY KEY,customer_id text NOT NULL REFERENCES customers(id),expires integer NOT NULL);
