// Package db owns the sqlite database: opening, migrating, and the core
// repositories (widgets, tabs, prefs, widget_cache).
package db

import (
	"database/sql"

	_ "modernc.org/sqlite"
)

// Open opens (creating if missing) the sqlite DB with the pragmas the app
// relies on: enforced foreign keys, WAL, and a busy timeout so concurrent
// scheduler/UI writes queue instead of failing.
func Open(path string) (*sql.DB, error) {
	dsn := "file:" + path + "?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)"
	d, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	if err := d.Ping(); err != nil {
		d.Close()
		return nil, err
	}
	return d, nil
}
