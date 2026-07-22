// Package pomodoro backs the pomodoro.timer widget: the countdown engine
// stays in the frontend (view-state), Go owns the session log and native
// notifications.
package pomodoro

import (
	"context"
	"database/sql"
	"time"
)

// Repo is the pomodoro_sessions repository (module-owned table).
type Repo struct{ DB *sql.DB }

// AddSession records one completed work block. finishedAt is epoch millis.
func (r *Repo) AddSession(ctx context.Context, finishedAt int64) error {
	_, err := r.DB.ExecContext(ctx,
		`INSERT INTO pomodoro_sessions (finished_at) VALUES (?)`, finishedAt)
	return err
}

// CountToday counts completed work blocks since local midnight of the day
// containing now.
func (r *Repo) CountToday(ctx context.Context, now time.Time) (int, error) {
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).UnixMilli()
	var n int
	err := r.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM pomodoro_sessions WHERE finished_at >= ?`, dayStart).Scan(&n)
	return n, err
}
