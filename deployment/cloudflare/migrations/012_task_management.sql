ALTER TABLE tasks ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high'));
ALTER TABLE tasks ADD COLUMN due_at integer;
ALTER TABLE tasks ADD COLUMN status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','done'));
ALTER TABLE tasks ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE tasks ADD COLUMN created_at integer NOT NULL DEFAULT 0;
UPDATE tasks SET created_at=CAST(strftime('%s','now') AS INTEGER)*1000, status=CASE WHEN done=1 THEN 'done' ELSE 'pending' END;
CREATE INDEX tasks_business_status ON tasks(business_id,status,due_at);

CREATE TRIGGER tasks_created_at AFTER INSERT ON tasks WHEN NEW.created_at = 0 BEGIN
  UPDATE tasks SET created_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE id=NEW.id;
END;
