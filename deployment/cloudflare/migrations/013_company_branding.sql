CREATE TABLE organization_settings (
 organization_id text PRIMARY KEY REFERENCES organizations(id),
 company_name text NOT NULL DEFAULT '',legal_name text NOT NULL DEFAULT '',tax_id text NOT NULL DEFAULT '',address text NOT NULL DEFAULT '',contact_email text NOT NULL DEFAULT '',contact_phone text NOT NULL DEFAULT '',website text NOT NULL DEFAULT '',
 app_name text NOT NULL DEFAULT 'Food Truck Live',logo text NOT NULL DEFAULT '',primary_color text NOT NULL DEFAULT '#ed8735',secondary_color text NOT NULL DEFAULT '#20271f',accent_color text NOT NULL DEFAULT '#f3a567'
);
INSERT INTO organization_settings(organization_id,company_name) SELECT id,name FROM organizations;
