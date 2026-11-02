CREATE INDEX IF NOT EXISTS audit_events_business_action_time_idx ON audit_events(business_id,action,created_at);
CREATE INDEX IF NOT EXISTS events_business_start_idx ON events(business_id,starts_at);
CREATE INDEX IF NOT EXISTS network_shifts_truck_time_idx ON network_shifts(organization_id,business_id,starts_at,ends_at);
