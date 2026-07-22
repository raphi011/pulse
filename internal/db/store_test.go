package db

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

func TestWidgetsAddListOrdered(t *testing.T) {
	ctx := context.Background()
	s := NewStore(open(t))
	widgets := []Widget{
		{ID: "w2", Type: "x", TabID: "default", Order: 2, Config: json.RawMessage(`{}`)},
		{ID: "w1", Type: "x", TabID: "default", Order: 1, Config: json.RawMessage(`{}`)},
	}
	for _, w := range widgets {
		if err := s.AddWidget(ctx, w); err != nil {
			t.Fatal(err)
		}
	}
	got, err := s.Widgets(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].ID != "w1" || got[1].ID != "w2" {
		t.Fatalf("want [w1 w2] ordered, got %+v", got)
	}
}

func TestWidgetMissingReturnsNil(t *testing.T) {
	s := NewStore(open(t))
	w, err := s.Widget(context.Background(), "nope")
	if err != nil || w != nil {
		t.Fatalf("want nil, nil; got %+v %v", w, err)
	}
}

func TestSetPositionsUpdatesAllRowsAtomically(t *testing.T) {
	ctx := context.Background()
	s := NewStore(open(t))
	for _, id := range []string{"w1", "w2"} {
		if err := s.AddWidget(ctx, Widget{ID: id, Type: "x", TabID: "default", Config: json.RawMessage(`{}`)}); err != nil {
			t.Fatal(err)
		}
	}
	err := s.SetPositions(ctx, []Position{
		{ID: "w1", Order: 5, ColSpan: 2, RowSpan: 3},
		{ID: "w2", Order: 6, ColSpan: 4, RowSpan: 8},
	})
	if err != nil {
		t.Fatal(err)
	}
	w1, err := s.Widget(ctx, "w1")
	if err != nil || w1 == nil || w1.Order != 5 || w1.ColSpan != 2 || w1.RowSpan != 3 {
		t.Fatalf("w1 not updated: %+v %v", w1, err)
	}
	w2, err := s.Widget(ctx, "w2")
	if err != nil || w2 == nil || w2.Order != 6 || w2.ColSpan != 4 || w2.RowSpan != 8 {
		t.Fatalf("w2 not updated: %+v %v", w2, err)
	}
}

func TestRemoveWidgetCascadesCache(t *testing.T) {
	ctx := context.Background()
	s := NewStore(open(t))
	w := Widget{ID: "w1", Type: "x", TabID: "default", Config: json.RawMessage(`{}`)}
	if err := s.AddWidget(ctx, w); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CacheSet(ctx, CacheRow{WidgetID: "w1", Status: "ok", Payload: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := s.RemoveWidget(ctx, "w1"); err != nil {
		t.Fatal(err)
	}
	row, err := s.CacheGet(ctx, "w1")
	if err != nil || row != nil {
		t.Fatalf("cache row survived: %v %v", row, err)
	}
}

func TestDeleteLastTabRefused(t *testing.T) {
	s := NewStore(open(t))
	err := s.DeleteTab(context.Background(), "default")
	if !errors.Is(err, ErrLastTab) {
		t.Fatalf("want ErrLastTab, got %v", err)
	}
}

func TestDeleteTabRemovesWidgetsCache(t *testing.T) {
	ctx := context.Background()
	s := NewStore(open(t))
	if err := s.AddTab(ctx, Tab{ID: "t1", Name: "T1", Order: 1}); err != nil {
		t.Fatal(err)
	}
	if err := s.AddWidget(ctx, Widget{ID: "w1", Type: "x", TabID: "t1", Config: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CacheSet(ctx, CacheRow{WidgetID: "w1", Status: "ok", Payload: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteTab(ctx, "t1"); err != nil {
		t.Fatal(err)
	}
	w, err := s.Widget(ctx, "w1")
	if err != nil || w != nil {
		t.Fatalf("widget survived tab delete: %+v %v", w, err)
	}
	row, err := s.CacheGet(ctx, "w1")
	if err != nil || row != nil {
		t.Fatalf("cache row survived tab delete: %+v %v", row, err)
	}
}

func TestPrefFallback(t *testing.T) {
	ctx := context.Background()
	s := NewStore(open(t))
	v, err := s.Pref(ctx, "theme", "dark")
	if err != nil || v != "dark" {
		t.Fatalf("want fallback dark, got %q %v", v, err)
	}
	if err := s.SetPref(ctx, "theme", "light"); err != nil {
		t.Fatal(err)
	}
	v, err = s.Pref(ctx, "theme", "dark")
	if err != nil || v != "light" {
		t.Fatalf("want light, got %q %v", v, err)
	}
}

func TestCacheSetUpsert(t *testing.T) {
	ctx := context.Background()
	s := NewStore(open(t))
	if err := s.AddWidget(ctx, Widget{ID: "w1", Type: "x", TabID: "default", Config: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	first, err := s.CacheSet(ctx, CacheRow{WidgetID: "w1", Status: "ok", Payload: json.RawMessage(`{"a":1}`)})
	if err != nil {
		t.Fatal(err)
	}
	if first.FetchedAt <= 0 {
		t.Fatalf("want FetchedAt > 0, got %d", first.FetchedAt)
	}
	second, err := s.CacheSet(ctx, CacheRow{WidgetID: "w1", Status: "ok", Payload: json.RawMessage(`{"a":2}`)})
	if err != nil {
		t.Fatal(err)
	}
	if second.FetchedAt <= 0 {
		t.Fatalf("want FetchedAt > 0, got %d", second.FetchedAt)
	}
	var n int
	if err := s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM widget_cache`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("want 1 row, got %d", n)
	}
	got, err := s.CacheGet(ctx, "w1")
	if err != nil || got == nil {
		t.Fatalf("cache row missing: %+v %v", got, err)
	}
	if string(got.Payload) != `{"a":2}` {
		t.Fatalf("want second write to win, got %s", got.Payload)
	}
}

func TestSetConfigRoundTrip(t *testing.T) {
	ctx := context.Background()
	s := NewStore(open(t))
	if err := s.AddWidget(ctx, Widget{ID: "w1", Type: "x", TabID: "default", Config: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetConfig(ctx, "w1", json.RawMessage(`{"foo":"bar"}`)); err != nil {
		t.Fatal(err)
	}
	w, err := s.Widget(ctx, "w1")
	if err != nil || w == nil || string(w.Config) != `{"foo":"bar"}` {
		t.Fatalf("config not updated: %+v %v", w, err)
	}
}

func TestSetTitleRoundTrip(t *testing.T) {
	ctx := context.Background()
	s := NewStore(open(t))
	if err := s.AddWidget(ctx, Widget{ID: "w1", Type: "x", TabID: "default", Config: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	title := "Hello"
	if err := s.SetTitle(ctx, "w1", &title); err != nil {
		t.Fatal(err)
	}
	w, err := s.Widget(ctx, "w1")
	if err != nil || w == nil || w.Title == nil || *w.Title != "Hello" {
		t.Fatalf("title not updated: %+v %v", w, err)
	}
}

func TestSetAccentRoundTrip(t *testing.T) {
	ctx := context.Background()
	s := NewStore(open(t))
	if err := s.AddWidget(ctx, Widget{ID: "w1", Type: "x", TabID: "default", Config: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	accent := "blue"
	if err := s.SetAccent(ctx, "w1", &accent); err != nil {
		t.Fatal(err)
	}
	w, err := s.Widget(ctx, "w1")
	if err != nil || w == nil || w.Accent == nil || *w.Accent != "blue" {
		t.Fatalf("accent not updated: %+v %v", w, err)
	}
}

func TestSetHiddenRoundTrip(t *testing.T) {
	ctx := context.Background()
	s := NewStore(open(t))
	if err := s.AddWidget(ctx, Widget{ID: "w1", Type: "x", TabID: "default", Config: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetHidden(ctx, "w1", true); err != nil {
		t.Fatal(err)
	}
	w, err := s.Widget(ctx, "w1")
	if err != nil || w == nil || !w.Hidden {
		t.Fatalf("hidden not updated: %+v %v", w, err)
	}
}

func TestSetWidgetTabRoundTrip(t *testing.T) {
	ctx := context.Background()
	s := NewStore(open(t))
	if err := s.AddTab(ctx, Tab{ID: "t2", Name: "T2", Order: 1}); err != nil {
		t.Fatal(err)
	}
	if err := s.AddWidget(ctx, Widget{ID: "w1", Type: "x", TabID: "default", Config: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetWidgetTab(ctx, "w1", "t2"); err != nil {
		t.Fatal(err)
	}
	w, err := s.Widget(ctx, "w1")
	if err != nil || w == nil || w.TabID != "t2" {
		t.Fatalf("tab not updated: %+v %v", w, err)
	}
}

func TestAddTabRoundTrip(t *testing.T) {
	ctx := context.Background()
	s := NewStore(open(t))
	if err := s.AddTab(ctx, Tab{ID: "t1", Name: "Work", Order: 1}); err != nil {
		t.Fatal(err)
	}
	tabs, err := s.Tabs(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, tb := range tabs {
		if tb.ID == "t1" && tb.Name == "Work" && tb.Order == 1 {
			return
		}
	}
	t.Fatalf("added tab not found: %+v", tabs)
}

func TestRenameTabRoundTrip(t *testing.T) {
	ctx := context.Background()
	s := NewStore(open(t))
	if err := s.AddTab(ctx, Tab{ID: "t1", Name: "Work", Order: 1}); err != nil {
		t.Fatal(err)
	}
	if err := s.RenameTab(ctx, "t1", "Renamed"); err != nil {
		t.Fatal(err)
	}
	tabs, err := s.Tabs(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, tb := range tabs {
		if tb.ID == "t1" {
			if tb.Name != "Renamed" {
				t.Fatalf("want Renamed, got %q", tb.Name)
			}
			return
		}
	}
	t.Fatal("tab not found after rename")
}

func TestSetTabOrderRoundTrip(t *testing.T) {
	ctx := context.Background()
	s := NewStore(open(t))
	if err := s.AddTab(ctx, Tab{ID: "t1", Name: "A", Order: 1}); err != nil {
		t.Fatal(err)
	}
	if err := s.AddTab(ctx, Tab{ID: "t2", Name: "B", Order: 2}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetTabOrder(ctx, []TabOrder{{ID: "t1", Order: 9}, {ID: "t2", Order: 3}}); err != nil {
		t.Fatal(err)
	}
	tabs, err := s.Tabs(ctx)
	if err != nil {
		t.Fatal(err)
	}
	orders := map[string]int{}
	for _, tb := range tabs {
		orders[tb.ID] = tb.Order
	}
	if orders["t1"] != 9 || orders["t2"] != 3 {
		t.Fatalf("order not updated correctly: %+v", orders)
	}
}
