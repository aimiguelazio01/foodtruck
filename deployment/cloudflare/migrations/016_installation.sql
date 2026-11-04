CREATE TABLE installation_state (
 id integer PRIMARY KEY CHECK(id=1),
 mode text NOT NULL CHECK(mode IN ('demo','system')),
 created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Existing installations are never offered to a new administrator.
INSERT INTO installation_state(id,mode)
SELECT 1,'system' WHERE EXISTS(SELECT 1 FROM users)
 OR EXISTS(SELECT 1 FROM organizations) OR EXISTS(SELECT 1 FROM businesses);
