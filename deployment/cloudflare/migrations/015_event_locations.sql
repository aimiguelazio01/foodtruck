ALTER TABLE events ADD COLUMN venue_name text NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN latitude real;
ALTER TABLE events ADD COLUMN longitude real;
ALTER TABLE events ADD COLUMN version integer NOT NULL DEFAULT 1;

CREATE TRIGGER events_coordinates_insert BEFORE INSERT ON events
WHEN NOT ((NEW.latitude IS NULL AND NEW.longitude IS NULL) OR
  (NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL
   AND NEW.latitude BETWEEN -90 AND 90 AND NEW.longitude BETWEEN -180 AND 180)) BEGIN
  SELECT RAISE(ABORT, 'Invalid event coordinates');
END;
CREATE TRIGGER events_coordinates_update BEFORE UPDATE ON events
WHEN NOT ((NEW.latitude IS NULL AND NEW.longitude IS NULL) OR
  (NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL
   AND NEW.latitude BETWEEN -90 AND 90 AND NEW.longitude BETWEEN -180 AND 180)) BEGIN
  SELECT RAISE(ABORT, 'Invalid event coordinates');
END;
CREATE TRIGGER events_version AFTER UPDATE ON events
WHEN NEW.version = OLD.version BEGIN
  UPDATE events SET version = OLD.version + 1 WHERE id = NEW.id;
END;
