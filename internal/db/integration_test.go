package db_test

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"

	"pulse/internal/db"
)

func openStore(t *testing.T) *db.Store {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	if err := db.Migrate(d); err != nil {
		t.Fatal(err)
	}
	return db.NewStore(d)
}

func TestRemoveWidgetsAndSetPrefAtomic(t *testing.T) {
	s := openStore(t)
	ctx := context.Background()
	for _, id := range []string{"w1", "w2", "w3"} {
		if err := s.AddWidget(ctx, db.Widget{ID: id, Type: "github.prs", TabID: "default", Config: json.RawMessage(`{}`)}); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.RemoveWidgetsAndSetPref(ctx, []string{"w1", "w2"}, "integration.github.enabled", "false"); err != nil {
		t.Fatal(err)
	}
	widgets, err := s.Widgets(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(widgets) != 1 || widgets[0].ID != "w3" {
		t.Fatalf("widgets = %+v", widgets)
	}
	v, err := s.Pref(ctx, "integration.github.enabled", "")
	if err != nil {
		t.Fatal(err)
	}
	if v != "false" {
		t.Errorf("pref = %q, want false", v)
	}
}

func TestRemoveWidgetsAndSetPrefNoWidgets(t *testing.T) {
	s := openStore(t)
	if err := s.RemoveWidgetsAndSetPref(context.Background(), nil, "integration.x.enabled", "false"); err != nil {
		t.Fatal(err)
	}
	v, _ := s.Pref(context.Background(), "integration.x.enabled", "")
	if v != "false" {
		t.Errorf("pref = %q", v)
	}
}
