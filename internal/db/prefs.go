package db

import (
	"context"
	"database/sql"
)

// Pref returns the stored value for key, or fallback when unset.
func (s *Store) Pref(ctx context.Context, key, fallback string) (string, error) {
	var value string
	err := s.DB.QueryRowContext(ctx, `SELECT value FROM prefs WHERE key = ?`, key).Scan(&value)
	if err == sql.ErrNoRows {
		return fallback, nil
	}
	if err != nil {
		return "", err
	}
	return value, nil
}

func (s *Store) SetPref(ctx context.Context, key, value string) error {
	_, err := s.DB.ExecContext(ctx,
		`INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		key, value)
	return err
}
