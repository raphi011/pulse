package db

import "database/sql"

// Store is the sqlite-backed repository for widgets, tabs, prefs, and the
// widget_cache. All methods take a context.Context and use plain
// database/sql (no ORM).
type Store struct{ DB *sql.DB }

// NewStore wraps an already-open, already-migrated *sql.DB.
func NewStore(d *sql.DB) *Store { return &Store{DB: d} }
