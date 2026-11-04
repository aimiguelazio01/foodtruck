CREATE TABLE IF NOT EXISTS membership_permissions (
 user_id text NOT NULL, business_id text NOT NULL,
 permissions text NOT NULL,
 PRIMARY KEY(user_id,business_id),
 FOREIGN KEY(user_id,business_id) REFERENCES memberships(user_id,business_id) ON DELETE CASCADE,
 CHECK (json_type(permissions)='object')
);
