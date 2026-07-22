package pomodoro

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"pulse/internal/db"
)

func testRepo(t *testing.T) *Repo {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	if err := db.Migrate(d); err != nil {
		t.Fatal(err)
	}
	return &Repo{DB: d}
}

func TestCountTodayCountsSinceLocalMidnight(t *testing.T) {
	r := testRepo(t)
	ctx := context.Background()
	now := time.Now()
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	if err := r.AddSession(ctx, midnight.Add(time.Hour).UnixMilli()); err != nil {
		t.Fatal(err)
	}
	if err := r.AddSession(ctx, midnight.Add(2*time.Hour).UnixMilli()); err != nil {
		t.Fatal(err)
	}
	if err := r.AddSession(ctx, midnight.Add(-time.Hour).UnixMilli()); err != nil { // yesterday
		t.Fatal(err)
	}

	got, err := r.CountToday(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	if got != 2 {
		t.Errorf("CountToday = %d, want 2 (yesterday's session excluded)", got)
	}
}
