ALTER TABLE events ADD COLUMN venue_name text NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN latitude double precision;
ALTER TABLE events ADD COLUMN longitude double precision;
ALTER TABLE events ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE events ADD CONSTRAINT event_coordinate_pair CHECK (
 (latitude IS NULL AND longitude IS NULL) OR
 (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
);
CREATE OR REPLACE FUNCTION advance_event_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.version := OLD.version + 1; RETURN NEW; END $$;
CREATE TRIGGER event_version BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION advance_event_version();
