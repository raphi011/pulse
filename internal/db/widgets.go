package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"
)

type Widget struct {
	ID      string          `json:"id"`
	Type    string          `json:"type"`
	Title   *string         `json:"title"`
	Accent  *string         `json:"accent"`
	Order   int             `json:"order"`
	ColSpan int             `json:"colSpan"`
	RowSpan int             `json:"rowSpan"`
	Hidden  bool            `json:"hidden"`
	TabID   string          `json:"tabId"`
	Config  json.RawMessage `json:"config"`
}

type Position struct {
	ID      string `json:"id"`
	Order   int    `json:"order"`
	ColSpan int    `json:"colSpan"`
	RowSpan int    `json:"rowSpan"`
}

const widgetCols = `id, type, title, accent, "order", col_span, row_span, hidden, tab_id, config`

func scanWidget(row interface{ Scan(...any) error }) (Widget, error) {
	var w Widget
	var config string
	err := row.Scan(&w.ID, &w.Type, &w.Title, &w.Accent, &w.Order, &w.ColSpan, &w.RowSpan, &w.Hidden, &w.TabID, &config)
	w.Config = json.RawMessage(config)
	return w, err
}

func (s *Store) Widgets(ctx context.Context) ([]Widget, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT `+widgetCols+` FROM widgets ORDER BY "order" ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Widget{}
	for rows.Next() {
		w, err := scanWidget(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

func (s *Store) Widget(ctx context.Context, id string) (*Widget, error) {
	w, err := scanWidget(s.DB.QueryRowContext(ctx, `SELECT `+widgetCols+` FROM widgets WHERE id = ?`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &w, nil
}

func (s *Store) AddWidget(ctx context.Context, w Widget) error {
	_, err := s.DB.ExecContext(ctx,
		`INSERT INTO widgets (`+widgetCols+`, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		w.ID, w.Type, w.Title, w.Accent, w.Order, w.ColSpan, w.RowSpan, w.Hidden, w.TabID, string(w.Config),
		time.Now().UnixMilli())
	return err
}

func (s *Store) SetPositions(ctx context.Context, ps []Position) error {
	if len(ps) == 0 {
		return nil
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, p := range ps {
		if _, err := tx.ExecContext(ctx,
			`UPDATE widgets SET "order" = ?, col_span = ?, row_span = ? WHERE id = ?`,
			p.Order, p.ColSpan, p.RowSpan, p.ID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) SetHidden(ctx context.Context, id string, hidden bool) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE widgets SET hidden = ? WHERE id = ?`, hidden, id)
	return err
}

func (s *Store) SetWidgetTab(ctx context.Context, id, tabID string) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE widgets SET tab_id = ? WHERE id = ?`, tabID, id)
	return err
}

func (s *Store) SetConfig(ctx context.Context, id string, config json.RawMessage) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE widgets SET config = ? WHERE id = ?`, string(config), id)
	return err
}

func (s *Store) SetTitle(ctx context.Context, id string, title *string) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE widgets SET title = ? WHERE id = ?`, title, id)
	return err
}

func (s *Store) SetAccent(ctx context.Context, id string, accent *string) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE widgets SET accent = ? WHERE id = ?`, accent, id)
	return err
}

func (s *Store) RemoveWidget(ctx context.Context, id string) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM widgets WHERE id = ?`, id)
	return err
}
