package bookmarks

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"pulse/internal/db"
)

func open(t *testing.T) *sql.DB {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	if err := db.Migrate(d); err != nil {
		t.Fatal(err)
	}
	return d
}

func TestNormalizeURL(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  string
		ok    bool
	}{
		{"bare host gets https", "example.com", "https://example.com", true},
		{"full url unchanged", "https://a.b/c", "https://a.b/c", true},
		{"blank not ok", "   ", "", false},
		{"scheme-only hostless garbage not ok", "https://", "", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := NormalizeURL(c.input)
			if ok != c.ok {
				t.Fatalf("NormalizeURL(%q) ok = %v, want %v (got %q)", c.input, ok, c.ok, got)
			}
			if ok && got != c.want {
				t.Fatalf("NormalizeURL(%q) = %q, want %q", c.input, got, c.want)
			}
		})
	}
}

func TestAddAssignsIncrementingOrderAndListReturnsInsertionOrder(t *testing.T) {
	ctx := context.Background()
	r := &Repo{DB: open(t)}

	b1, err := r.Add(ctx, "First", "example.com")
	if err != nil {
		t.Fatal(err)
	}
	b2, err := r.Add(ctx, "Second", "https://second.example")
	if err != nil {
		t.Fatal(err)
	}

	if b1.Title != "First" || b1.URL != "https://example.com" {
		t.Fatalf("unexpected b1: %+v", b1)
	}
	if b2.Title != "Second" || b2.URL != "https://second.example" {
		t.Fatalf("unexpected b2: %+v", b2)
	}
	if b1.ID == "" || b2.ID == "" || b1.ID == b2.ID {
		t.Fatalf("expected distinct non-empty ids, got %q %q", b1.ID, b2.ID)
	}

	got, err := r.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].ID != b1.ID || got[1].ID != b2.ID {
		t.Fatalf("want [b1 b2] in insertion order, got %+v", got)
	}
}

func TestAddWithInvalidURLErrorsAndInsertsNothing(t *testing.T) {
	ctx := context.Background()
	r := &Repo{DB: open(t)}

	_, err := r.Add(ctx, "Bad", "   ")
	if err == nil {
		t.Fatal("expected error for invalid URL, got nil")
	}

	got, err := r.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("expected no rows inserted, got %+v", got)
	}
}

func TestListReturnsEmptyNonNilSliceWhenNoRows(t *testing.T) {
	ctx := context.Background()
	r := &Repo{DB: open(t)}

	got, err := r.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if got == nil {
		t.Fatal("expected non-nil empty slice, got nil")
	}
	if len(got) != 0 {
		t.Fatalf("expected empty slice, got %+v", got)
	}
}

func TestRemoveDeletes(t *testing.T) {
	ctx := context.Background()
	r := &Repo{DB: open(t)}

	b, err := r.Add(ctx, "ToRemove", "example.com")
	if err != nil {
		t.Fatal(err)
	}
	if err := r.Remove(ctx, b.ID); err != nil {
		t.Fatal(err)
	}
	got, err := r.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("expected bookmark removed, got %+v", got)
	}
}

func TestRemoveNonexistentIsNoOp(t *testing.T) {
	ctx := context.Background()
	r := &Repo{DB: open(t)}

	if err := r.Remove(ctx, "does-not-exist"); err != nil {
		t.Fatalf("expected no error removing nonexistent id, got %v", err)
	}
}

func TestManifestsWorksWithNilRepo(t *testing.T) {
	m := New(nil)
	manifests := m.Manifests()
	if len(manifests) != 1 {
		t.Fatalf("expected 1 manifest, got %d", len(manifests))
	}
	if manifests[0].Type != "bookmarks.links" {
		t.Fatalf("unexpected type: %q", manifests[0].Type)
	}
	if manifests[0].Title != "Bookmarks" {
		t.Fatalf("unexpected title: %q", manifests[0].Title)
	}
	if manifests[0].Refreshable {
		t.Fatal("expected Refreshable to be false")
	}
	if manifests[0].ConfigFields == nil || len(manifests[0].ConfigFields) != 0 {
		t.Fatalf("expected empty non-nil ConfigFields, got %+v", manifests[0].ConfigFields)
	}
}
