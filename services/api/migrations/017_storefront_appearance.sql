ALTER TABLE business_settings ADD COLUMN background_color text NOT NULL DEFAULT '';
ALTER TABLE business_settings ADD COLUMN font_family text NOT NULL DEFAULT 'original';
ALTER TABLE business_settings ADD COLUMN page_layout text NOT NULL DEFAULT 'standard';
