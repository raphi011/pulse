// Package bookmarks is the local-data widget module for user-managed link
// bookmarks: a sqlite-backed repo, a widget-module manifest, and a
// Wails-bound Service.
package bookmarks

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Bookmark is the frontend-facing shape of one saved link.
type Bookmark struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	URL   string `json:"url"`
}

// Repo is the sqlite-backed CRUD layer over the bookmarks table.
type Repo struct{ DB *sql.DB }

// List returns all bookmarks ordered by their "order" column, oldest first.
// It returns an empty, non-nil slice when there are no rows.
func (r *Repo) List(ctx context.Context) ([]Bookmark, error) {
	rows, err := r.DB.QueryContext(ctx,
		`SELECT id, title, url FROM bookmarks ORDER BY "order" ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Bookmark{}
	for rows.Next() {
		var b Bookmark
		if err := rows.Scan(&b.ID, &b.Title, &b.URL); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// Add normalizes rawURL, assigns the next order (max existing + 1), and
// inserts a new bookmark. An invalid URL errors before any write happens.
func (r *Repo) Add(ctx context.Context, title, rawURL string) (Bookmark, error) {
	normalized, ok := NormalizeURL(rawURL)
	if !ok {
		return Bookmark{}, fmt.Errorf("invalid URL: %q", rawURL)
	}

	var maxOrder sql.NullInt64
	if err := r.DB.QueryRowContext(ctx, `SELECT MAX("order") FROM bookmarks`).Scan(&maxOrder); err != nil {
		return Bookmark{}, err
	}
	order := int64(0)
	if maxOrder.Valid {
		order = maxOrder.Int64 + 1
	}

	b := Bookmark{ID: uuid.NewString(), Title: title, URL: normalized}
	_, err := r.DB.ExecContext(ctx,
		`INSERT INTO bookmarks (id, title, url, "order", created_at) VALUES (?, ?, ?, ?, ?)`,
		b.ID, b.Title, b.URL, order, time.Now().UnixMilli())
	if err != nil {
		return Bookmark{}, err
	}
	return b, nil
}

// Remove deletes a bookmark by id. Removing a nonexistent id is a no-op.
func (r *Repo) Remove(ctx context.Context, id string) error {
	_, err := r.DB.ExecContext(ctx, `DELETE FROM bookmarks WHERE id = ?`, id)
	return err
}

// NormalizeURL is a port of the frontend's normalizeUrl: trims whitespace,
// prepends https:// when no http(s):// scheme is present, parses with
// net/url, and requires a host. It returns the canonical string form and
// whether input was a valid URL at all.
func NormalizeURL(input string) (string, bool) {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return "", false
	}
	if !regexp.MustCompile(`(?i)^https?://`).MatchString(trimmed) {
		trimmed = "https://" + trimmed
	}
	u, err := url.Parse(trimmed)
	if err != nil || u.Host == "" {
		return "", false
	}
	return u.String(), true
}
