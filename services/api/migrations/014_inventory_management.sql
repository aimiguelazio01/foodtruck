ALTER TABLE inventory ADD COLUMN deleted_at bigint;
ALTER TABLE inventory ADD COLUMN version integer NOT NULL DEFAULT 1;
CREATE OR REPLACE FUNCTION advance_inventory_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_version BEFORE UPDATE ON inventory FOR EACH ROW EXECUTE FUNCTION advance_inventory_version();
