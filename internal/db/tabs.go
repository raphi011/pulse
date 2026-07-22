package db

import (
	"context"
	"errors"
	"time"
)

type Tab struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Order int    `json:"order"`
}

// TabOrder is one entry of a batch tab-reorder request.
type TabOrder struct {
	ID    string `json:"id"`
	Order int    `json:"order"`
}

// ErrLastTab is returned by DeleteTab when asked to remove the only
// remaining tab; the app always needs at least one tab to hold widgets.
var ErrLastTab = errors.New("cannot delete the last remaining tab")

const tabCols = `id, name, "order"`

func scanTab(row interface{ Scan(...any) error }) (Tab, error) {
	var t Tab
	err := row.Scan(&t.ID, &t.Name, &t.Order)
	return t, err
}

func (s *Store) Tabs(ctx context.Context) ([]Tab, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT `+tabCols+` FROM tabs ORDER BY "order" ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Tab{}
	for rows.Next() {
		t, err := scanTab(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) AddTab(ctx context.Context, t Tab) error {
	_, err := s.DB.ExecContext(ctx,
		`INSERT INTO tabs (`+tabCols+`, created_at) VALUES (?, ?, ?, ?)`,
		t.ID, t.Name, t.Order, time.Now().UnixMilli())
	return err
}

func (s *Store) RenameTab(ctx context.Context, id, name string) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE tabs SET name = ? WHERE id = ?`, name, id)
	return err
}

// DeleteTab removes a tab. Its widgets and their cache rows die via FK
// cascade. Refuses to delete the last remaining tab.
func (s *Store) DeleteTab(ctx context.Context, id string) error {
	var n int
	if err := s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM tabs`).Scan(&n); err != nil {
		return err
	}
	if n <= 1 {
		return ErrLastTab
	}
	_, err := s.DB.ExecContext(ctx, `DELETE FROM tabs WHERE id = ?`, id)
	return err
}

func (s *Store) SetTabOrder(ctx context.Context, orders []TabOrder) error {
	if len(orders) == 0 {
		return nil
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, o := range orders {
		if _, err := tx.ExecContext(ctx, `UPDATE tabs SET "order" = ? WHERE id = ?`, o.Order, o.ID); err != nil {
			return err
		}
	}
	return tx.Commit()
}
