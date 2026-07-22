package db

import (
	"context"
	"strings"
)

// RemoveWidgetsAndSetPref deletes the given widgets (their cache rows cascade
// via FK) and upserts a pref in one transaction — disabling an integration
// must be atomic.
func (s *Store) RemoveWidgetsAndSetPref(ctx context.Context, ids []string, key, value string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if len(ids) > 0 {
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
		args := make([]any, len(ids))
		for i, id := range ids {
			args[i] = id
		}
		if _, err := tx.ExecContext(ctx,
			`DELETE FROM widgets WHERE id IN (`+placeholders+`)`, args...); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		key, value); err != nil {
		return err
	}
	return tx.Commit()
}
