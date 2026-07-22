package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"
)

type CacheRow struct {
	WidgetID  string          `json:"widgetId"`
	Payload   json.RawMessage `json:"payload"`
	FetchedAt int64           `json:"fetchedAt"`
	Status    string          `json:"status"` // "ok" | "error"
	Error     *string         `json:"error"`
	ErrorKind *string         `json:"errorKind"`
}

const cacheCols = `widget_id, payload, fetched_at, status, error, error_kind`

func scanCacheRow(row interface{ Scan(...any) error }) (CacheRow, error) {
	var r CacheRow
	var payload sql.NullString
	err := row.Scan(&r.WidgetID, &payload, &r.FetchedAt, &r.Status, &r.Error, &r.ErrorKind)
	if err != nil {
		return r, err
	}
	if payload.Valid {
		r.Payload = json.RawMessage(payload.String)
	}
	return r, nil
}

// CacheGet returns nil, nil when there is no cached row for widgetID.
func (s *Store) CacheGet(ctx context.Context, widgetID string) (*CacheRow, error) {
	row, err := scanCacheRow(s.DB.QueryRowContext(ctx, `SELECT `+cacheCols+` FROM widget_cache WHERE widget_id = ?`, widgetID))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// CacheSet stamps FetchedAt with the current time and upserts the row,
// returning the stamped row.
func (s *Store) CacheSet(ctx context.Context, row CacheRow) (CacheRow, error) {
	row.FetchedAt = time.Now().UnixMilli()
	var payload any
	if row.Payload != nil {
		payload = string(row.Payload)
	}
	_, err := s.DB.ExecContext(ctx,
		`INSERT INTO widget_cache (`+cacheCols+`) VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(widget_id) DO UPDATE SET
			payload = excluded.payload,
			fetched_at = excluded.fetched_at,
			status = excluded.status,
			error = excluded.error,
			error_kind = excluded.error_kind`,
		row.WidgetID, payload, row.FetchedAt, row.Status, row.Error, row.ErrorKind)
	if err != nil {
		return CacheRow{}, err
	}
	return row, nil
}

func (s *Store) CacheWipe(ctx context.Context) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM widget_cache`)
	return err
}
