CREATE TABLE domain_events(id text PRIMARY KEY,business_id text NOT NULL REFERENCES businesses(id),entity text NOT NULL DEFAULT 'operations',created_at bigint NOT NULL);
CREATE INDEX domain_events_business_date ON domain_events(business_id,created_at);
