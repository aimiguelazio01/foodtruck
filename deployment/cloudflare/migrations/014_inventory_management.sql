ALTER TABLE inventory ADD COLUMN deleted_at integer;
ALTER TABLE inventory ADD COLUMN version integer NOT NULL DEFAULT 1;
CREATE TRIGGER inventory_version AFTER UPDATE ON inventory
WHEN NEW.version = OLD.version BEGIN
  UPDATE inventory SET version = OLD.version + 1 WHERE id = NEW.id;
END;
