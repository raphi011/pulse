CREATE TABLE tabs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE widgets (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT,
  accent TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  col_span INTEGER NOT NULL DEFAULT 1,
  row_span INTEGER NOT NULL DEFAULT 6,
  hidden INTEGER NOT NULL DEFAULT 0,
  tab_id TEXT NOT NULL REFERENCES tabs(id) ON DELETE CASCADE,
  config TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE widget_cache (
  widget_id TEXT PRIMARY KEY REFERENCES widgets(id) ON DELETE CASCADE,
  payload TEXT,
  fetched_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  error TEXT,
  error_kind TEXT
) STRICT;

CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  icon TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE prefs (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE pomodoro_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finished_at INTEGER NOT NULL
) STRICT;

-- Widgets need a home tab from the first boot (FK is enforced).
INSERT INTO tabs (id, name, "order", created_at) VALUES ('default', 'Main', 0, 0);
