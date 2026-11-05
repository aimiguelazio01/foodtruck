CREATE TABLE IF NOT EXISTS hosting_status(id integer PRIMARY KEY CHECK(id=1),active integer NOT NULL,checked_at integer NOT NULL,last_active_at integer);
