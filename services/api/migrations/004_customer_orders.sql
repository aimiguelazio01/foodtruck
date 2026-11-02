ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id text REFERENCES customers(id);
CREATE INDEX IF NOT EXISTS orders_customer_id_idx ON orders(customer_id);
