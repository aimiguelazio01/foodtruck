CREATE TABLE IF NOT EXISTS customer_password_resets(hash text PRIMARY KEY,customer_id text NOT NULL REFERENCES customers(id),expires integer NOT NULL);
