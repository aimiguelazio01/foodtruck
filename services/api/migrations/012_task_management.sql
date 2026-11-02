ALTER TABLE tasks ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high'));
ALTER TABLE tasks ADD COLUMN due_at bigint;
ALTER TABLE tasks ADD COLUMN status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','done'));
ALTER TABLE tasks ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE tasks ADD COLUMN created_at bigint NOT NULL DEFAULT (extract(epoch FROM clock_timestamp())*1000)::bigint;
UPDATE tasks SET status=CASE WHEN done=1 THEN 'done' ELSE 'pending' END;
CREATE INDEX tasks_business_status ON tasks(business_id,status,due_at);
