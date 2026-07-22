package db

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func open(t *testing.T) *sql.DB {
	t.Helper()
	d, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	if err := Migrate(d); err != nil {
		t.Fatal(err)
	}
	return d
}

func TestMigrateIsIdempotent(t *testing.T) {
	d := open(t)
	if err := Migrate(d); err != nil {
		t.Fatal(err)
	}
}

func TestDefaultTabSeeded(t *testing.T) {
	d := open(t)
	var name string
	if err := d.QueryRow(`SELECT name FROM tabs WHERE id = 'default'`).Scan(&name); err != nil {
		t.Fatal(err)
	}
}

func TestForeignKeyCascadeTabToWidgetToCache(t *testing.T) {
	d := open(t)
	mustExec(t, d, `INSERT INTO tabs (id, name, "order", created_at) VALUES ('t1', 'T', 1, 0)`)
	mustExec(t, d, `INSERT INTO widgets (id, type, tab_id, config, created_at) VALUES ('w1', 'x', 't1', '{}', 0)`)
	mustExec(t, d, `INSERT INTO widget_cache (widget_id, fetched_at, status) VALUES ('w1', 0, 'ok')`)
	mustExec(t, d, `DELETE FROM tabs WHERE id = 't1'`)
	for _, q := range []string{`SELECT COUNT(*) FROM widgets`, `SELECT COUNT(*) FROM widget_cache`} {
		var n int
		if err := d.QueryRow(q).Scan(&n); err != nil || n != 0 {
			t.Fatalf("%s: n=%d err=%v (cascade broken)", q, n, err)
		}
	}
}

func TestStrictRejectsWrongType(t *testing.T) {
	d := open(t)
	if _, err := d.Exec(`INSERT INTO tabs (id, name, "order", created_at) VALUES ('x', 'y', 'abc', 0)`); err == nil {
		t.Fatal("STRICT table accepted non-numeric TEXT into an INTEGER column")
	}
}

func mustExec(t *testing.T, d *sql.DB, q string, args ...any) {
	t.Helper()
	if _, err := d.Exec(q, args...); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
}
