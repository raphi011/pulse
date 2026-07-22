package dashboard

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"testing"

	"pulse/internal/cli"
	"pulse/internal/db"
	"pulse/internal/module"
)

// recorder is the test Emitter fixture from the brief: records every emitted
// event as "<name>:<data>" for assertion.
type recorder struct {
	mu     sync.Mutex
	events []string
}

func (r *recorder) Emit(name string, data any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, fmt.Sprintf("%s:%v", name, data))
}

func (r *recorder) has(event string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, e := range r.events {
		if e == event {
			return true
		}
	}
	return false
}

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

// fakeModule is a minimal module.Module for driving GetWidgetData/registry
// dispatch without a real integration.
type fakeModule struct {
	manifests []module.Manifest
	fetch     func(ctx context.Context, widgetType string, config map[string]any) (any, error)
	calls     int
}

func (m *fakeModule) Manifests() []module.Manifest { return m.manifests }

func (m *fakeModule) Fetch(ctx context.Context, wt string, c map[string]any) (any, error) {
	m.calls++
	return m.fetch(ctx, wt, c)
}

// widgetManifest is the one widget type used across these tests: a single
// number field "n" defaulting to 1.
func widgetManifest() module.Manifest {
	return module.Manifest{
		Type:        "widget",
		Title:       "Widget",
		Refreshable: true,
		ConfigFields: []module.ConfigField{
			{Key: "n", Label: "N", Kind: module.FieldNumber, Default: 1.0},
		},
	}
}

func newRegistry(t *testing.T, mod *fakeModule) *module.Registry {
	t.Helper()
	reg, err := module.NewRegistry(mod)
	if err != nil {
		t.Fatal(err)
	}
	return reg
}

func TestCreateWidgetDefaultsAndOrder(t *testing.T) {
	store := openStore(t)
	mod := &fakeModule{manifests: []module.Manifest{widgetManifest()}}
	svc := NewService(store, newRegistry(t, mod), &recorder{})

	first, err := svc.CreateWidget("widget", "")
	if err != nil {
		t.Fatal(err)
	}
	if first.Order != 0 {
		t.Fatalf("want order 0, got %d", first.Order)
	}
	if first.ColSpan != 1 || first.RowSpan != 6 || first.Hidden {
		t.Fatalf("want colSpan=1 rowSpan=6 hidden=false, got %+v", first)
	}
	if first.TabID != "default" {
		t.Fatalf("want tabID default, got %q", first.TabID)
	}
	if string(first.Config) != `{"n":1}` {
		t.Fatalf("want default config {\"n\":1}, got %s", first.Config)
	}
	if first.ID == "" {
		t.Fatal("want non-empty generated ID")
	}

	second, err := svc.CreateWidget("widget", "")
	if err != nil {
		t.Fatal(err)
	}
	if second.Order != 1 {
		t.Fatalf("want order 1, got %d", second.Order)
	}
}

func TestGetWidgetDataCacheHitNoFetch(t *testing.T) {
	ctx := context.Background()
	store := openStore(t)
	mod := &fakeModule{
		manifests: []module.Manifest{widgetManifest()},
		fetch: func(ctx context.Context, wt string, c map[string]any) (any, error) {
			t.Fatal("fetch should not be called on cache hit")
			return nil, nil
		},
	}
	svc := NewService(store, newRegistry(t, mod), &recorder{})

	if err := store.AddWidget(ctx, db.Widget{ID: "w1", Type: "widget", TabID: "default", Config: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CacheSet(ctx, db.CacheRow{WidgetID: "w1", Status: "ok", Payload: json.RawMessage(`{"cached":true}`)}); err != nil {
		t.Fatal(err)
	}

	row, err := svc.GetWidgetData("w1", false)
	if err != nil {
		t.Fatal(err)
	}
	if string(row.Payload) != `{"cached":true}` {
		t.Fatalf("want cached payload returned untouched, got %s", row.Payload)
	}
	if mod.calls != 0 {
		t.Fatalf("want 0 fetch calls, got %d", mod.calls)
	}
}

func TestGetWidgetDataRefreshFetchesCachesEmits(t *testing.T) {
	ctx := context.Background()
	store := openStore(t)
	mod := &fakeModule{
		manifests: []module.Manifest{widgetManifest()},
		fetch: func(ctx context.Context, wt string, c map[string]any) (any, error) {
			return map[string]any{"n": c["n"]}, nil
		},
	}
	rec := &recorder{}
	svc := NewService(store, newRegistry(t, mod), rec)

	if err := store.AddWidget(ctx, db.Widget{ID: "w1", Type: "widget", TabID: "default", Config: json.RawMessage(`{"n":5}`)}); err != nil {
		t.Fatal(err)
	}

	row, err := svc.GetWidgetData("w1", true)
	if err != nil {
		t.Fatal(err)
	}
	if mod.calls != 1 {
		t.Fatalf("want 1 fetch call, got %d", mod.calls)
	}
	if row.Status != "ok" {
		t.Fatalf("want status ok, got %q", row.Status)
	}
	if string(row.Payload) != `{"n":5}` {
		t.Fatalf("want payload {\"n\":5}, got %s", row.Payload)
	}
	if !rec.has("widget:cache-updated:w1") {
		t.Fatalf("want cache-updated event emitted, got %v", rec.events)
	}
}

func TestGetWidgetDataFetchErrorAuthPreservesPayload(t *testing.T) {
	ctx := context.Background()
	store := openStore(t)
	mod := &fakeModule{
		manifests: []module.Manifest{widgetManifest()},
		fetch: func(ctx context.Context, wt string, c map[string]any) (any, error) {
			return nil, &cli.Error{Kind: cli.KindAuth, Message: "not authenticated"}
		},
	}
	rec := &recorder{}
	svc := NewService(store, newRegistry(t, mod), rec)

	if err := store.AddWidget(ctx, db.Widget{ID: "w1", Type: "widget", TabID: "default", Config: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CacheSet(ctx, db.CacheRow{WidgetID: "w1", Status: "ok", Payload: json.RawMessage(`{"old":1}`)}); err != nil {
		t.Fatal(err)
	}

	row, err := svc.GetWidgetData("w1", true)
	if err != nil {
		t.Fatal(err)
	}
	if row.Status != "error" {
		t.Fatalf("want status error, got %q", row.Status)
	}
	if row.ErrorKind == nil || *row.ErrorKind != "auth" {
		t.Fatalf("want errorKind auth, got %v", row.ErrorKind)
	}
	if string(row.Payload) != `{"old":1}` {
		t.Fatalf("want previous payload preserved, got %s", row.Payload)
	}
	if !rec.has("widget:cache-updated:w1") {
		t.Fatalf("want cache-updated event emitted, got %v", rec.events)
	}
}

func TestGetWidgetDataInvalidStoredConfig(t *testing.T) {
	ctx := context.Background()
	store := openStore(t)
	mod := &fakeModule{
		manifests: []module.Manifest{widgetManifest()},
		fetch: func(ctx context.Context, wt string, c map[string]any) (any, error) {
			t.Fatal("fetch should not be called with invalid config")
			return nil, nil
		},
	}
	svc := NewService(store, newRegistry(t, mod), &recorder{})

	if err := store.AddWidget(ctx, db.Widget{ID: "w1", Type: "widget", TabID: "default", Config: json.RawMessage(`{"n":"not-a-number"}`)}); err != nil {
		t.Fatal(err)
	}

	row, err := svc.GetWidgetData("w1", true)
	if err != nil {
		t.Fatal(err)
	}
	if row.Status != "error" {
		t.Fatalf("want status error, got %q", row.Status)
	}
	if row.Error == nil || *row.Error != "Invalid config — open Configure and re-save this widget." {
		t.Fatalf("want invalid-config message, got %v", row.Error)
	}
	if row.ErrorKind == nil || *row.ErrorKind != "failed" {
		t.Fatalf("want errorKind failed, got %v", row.ErrorKind)
	}
}

func TestGetWidgetDataUnknownType(t *testing.T) {
	ctx := context.Background()
	store := openStore(t)
	mod := &fakeModule{manifests: []module.Manifest{widgetManifest()}}
	svc := NewService(store, newRegistry(t, mod), &recorder{})

	if err := store.AddWidget(ctx, db.Widget{ID: "w1", Type: "ghost", TabID: "default", Config: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}

	row, err := svc.GetWidgetData("w1", true)
	if err != nil {
		t.Fatal(err)
	}
	if row.Status != "error" {
		t.Fatalf("want status error, got %q", row.Status)
	}
	if row.Error == nil || *row.Error != "Unknown widget type: ghost" {
		t.Fatalf("want unknown-type message, got %v", row.Error)
	}
	if row.ErrorKind == nil || *row.ErrorKind != "failed" {
		t.Fatalf("want errorKind failed, got %v", row.ErrorKind)
	}
}

func TestGetWidgetDataMissingWidget(t *testing.T) {
	store := openStore(t)
	mod := &fakeModule{manifests: []module.Manifest{widgetManifest()}}
	svc := NewService(store, newRegistry(t, mod), &recorder{})

	_, err := svc.GetWidgetData("nope", false)
	if err == nil {
		t.Fatal("want error for missing widget")
	}
}

func TestEnsureCacheVersionWipesOnMismatchAndNoOpsWhenMatching(t *testing.T) {
	ctx := context.Background()
	store := openStore(t)
	mod := &fakeModule{manifests: []module.Manifest{widgetManifest()}}
	svc := NewService(store, newRegistry(t, mod), &recorder{})

	if err := store.AddWidget(ctx, db.Widget{ID: "w1", Type: "widget", TabID: "default", Config: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CacheSet(ctx, db.CacheRow{WidgetID: "w1", Status: "ok", Payload: json.RawMessage(`{"a":1}`)}); err != nil {
		t.Fatal(err)
	}
	if err := store.SetPref(ctx, "cacheVersion", "0"); err != nil {
		t.Fatal(err)
	}

	if err := svc.EnsureCacheVersion(); err != nil {
		t.Fatal(err)
	}
	row, err := store.CacheGet(ctx, "w1")
	if err != nil {
		t.Fatal(err)
	}
	if row != nil {
		t.Fatalf("want cache wiped on mismatch, got %+v", row)
	}
	stamped, err := store.Pref(ctx, "cacheVersion", "")
	if err != nil {
		t.Fatal(err)
	}
	if stamped != fmt.Sprint(CacheVersion) {
		t.Fatalf("want stamped version %d, got %q", CacheVersion, stamped)
	}

	// Re-seed a cache row and run again: version now matches, so it must
	// be a no-op (row survives).
	if _, err := store.CacheSet(ctx, db.CacheRow{WidgetID: "w1", Status: "ok", Payload: json.RawMessage(`{"a":2}`)}); err != nil {
		t.Fatal(err)
	}
	if err := svc.EnsureCacheVersion(); err != nil {
		t.Fatal(err)
	}
	row, err = store.CacheGet(ctx, "w1")
	if err != nil {
		t.Fatal(err)
	}
	if row == nil {
		t.Fatal("want cache row to survive a matching-version EnsureCacheVersion call")
	}
}

func TestUpdateWidgetValidConfigStoredNormalized(t *testing.T) {
	store := openStore(t)
	mod := &fakeModule{manifests: []module.Manifest{widgetManifest()}}
	svc := NewService(store, newRegistry(t, mod), &recorder{})

	w, err := svc.CreateWidget("widget", "")
	if err != nil {
		t.Fatal(err)
	}

	raw := json.RawMessage(`{"n":42,"unknown":"stripped"}`)
	result, err := svc.UpdateWidget(w.ID, WidgetPatch{Config: &raw})
	if err != nil {
		t.Fatal(err)
	}
	if string(result.Config) != `{"n":42}` {
		t.Fatalf("want normalized config {\"n\":42}, got %s", result.Config)
	}

	updated, err := store.Widget(context.Background(), w.ID)
	if err != nil {
		t.Fatal(err)
	}
	if string(updated.Config) != `{"n":42}` {
		t.Fatalf("want stored config normalized, got %s", updated.Config)
	}
}

func TestUpdateWidgetInvalidConfigNotStored(t *testing.T) {
	store := openStore(t)
	mod := &fakeModule{manifests: []module.Manifest{widgetManifest()}}
	svc := NewService(store, newRegistry(t, mod), &recorder{})

	w, err := svc.CreateWidget("widget", "")
	if err != nil {
		t.Fatal(err)
	}
	originalConfig := string(w.Config)

	bad := json.RawMessage(`{"n":"nope"}`)
	_, err = svc.UpdateWidget(w.ID, WidgetPatch{Config: &bad})
	if err == nil {
		t.Fatal("want error for invalid config")
	}

	unchanged, err := store.Widget(context.Background(), w.ID)
	if err != nil {
		t.Fatal(err)
	}
	if string(unchanged.Config) != originalConfig {
		t.Fatalf("want config unchanged after invalid update, got %s (was %s)", unchanged.Config, originalConfig)
	}
}

func TestUpdateWidgetSetTitleNilClears(t *testing.T) {
	store := openStore(t)
	mod := &fakeModule{manifests: []module.Manifest{widgetManifest()}}
	svc := NewService(store, newRegistry(t, mod), &recorder{})

	w, err := svc.CreateWidget("widget", "")
	if err != nil {
		t.Fatal(err)
	}
	title := "Custom title"
	if _, err := svc.UpdateWidget(w.ID, WidgetPatch{SetTitle: true, Title: &title}); err != nil {
		t.Fatal(err)
	}
	set, err := store.Widget(context.Background(), w.ID)
	if err != nil || set.Title == nil || *set.Title != "Custom title" {
		t.Fatalf("title not set: %+v %v", set, err)
	}

	result, err := svc.UpdateWidget(w.ID, WidgetPatch{SetTitle: true, Title: nil})
	if err != nil {
		t.Fatal(err)
	}
	if result.Title != nil {
		t.Fatalf("want cleared title in result, got %v", *result.Title)
	}
	cleared, err := store.Widget(context.Background(), w.ID)
	if err != nil || cleared.Title != nil {
		t.Fatalf("title not cleared: %+v %v", cleared, err)
	}
}

func TestUpdateWidgetHiddenPatch(t *testing.T) {
	store := openStore(t)
	mod := &fakeModule{manifests: []module.Manifest{widgetManifest()}}
	svc := NewService(store, newRegistry(t, mod), &recorder{})

	w, err := svc.CreateWidget("widget", "")
	if err != nil {
		t.Fatal(err)
	}
	hidden := true
	if _, err := svc.UpdateWidget(w.ID, WidgetPatch{Hidden: &hidden}); err != nil {
		t.Fatal(err)
	}
	got, err := store.Widget(context.Background(), w.ID)
	if err != nil || got == nil || !got.Hidden {
		t.Fatalf("hidden not applied: %+v %v", got, err)
	}
}

func TestUpdateWidgetMissingWidget(t *testing.T) {
	store := openStore(t)
	mod := &fakeModule{manifests: []module.Manifest{widgetManifest()}}
	svc := NewService(store, newRegistry(t, mod), &recorder{})

	_, err := svc.UpdateWidget("nope", WidgetPatch{})
	if err == nil {
		t.Fatal("want error for missing widget")
	}
}

func TestLayoutActiveTabFallsBackToFirstTabWhenSavedMissing(t *testing.T) {
	ctx := context.Background()
	store := openStore(t)
	mod := &fakeModule{manifests: []module.Manifest{widgetManifest()}}
	svc := NewService(store, newRegistry(t, mod), &recorder{})

	if err := store.SetPref(ctx, "ui.activeTab", "ghost-tab-id"); err != nil {
		t.Fatal(err)
	}

	snapshot, err := svc.Layout()
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Tabs) == 0 {
		t.Fatal("want at least the seeded default tab")
	}
	if snapshot.ActiveTabID != snapshot.Tabs[0].ID {
		t.Fatalf("want active tab to fall back to first tab %q, got %q", snapshot.Tabs[0].ID, snapshot.ActiveTabID)
	}
	if snapshot.Prefs.Theme != "dark" {
		t.Fatalf("want default theme dark, got %q", snapshot.Prefs.Theme)
	}
}

// fakeKicker is the test double for the scheduler-facing kicker interface:
// it just counts Kick calls.
type fakeKicker struct{ kicks int }

func (k *fakeKicker) Kick() { k.kicks++ }

func TestAutoRefreshDefaultsOffAndRoundTrips(t *testing.T) {
	store := openStore(t)
	mod := &fakeModule{manifests: []module.Manifest{widgetManifest()}}
	svc := NewService(store, newRegistry(t, mod), &recorder{})

	on, err := svc.AutoRefresh()
	if err != nil {
		t.Fatal(err)
	}
	if on {
		t.Fatal("want autoRefresh default off")
	}

	if err := svc.SetAutoRefresh(true); err != nil {
		t.Fatal(err)
	}
	on, err = svc.AutoRefresh()
	if err != nil {
		t.Fatal(err)
	}
	if !on {
		t.Fatal("want autoRefresh on after SetAutoRefresh(true)")
	}

	if err := svc.SetAutoRefresh(false); err != nil {
		t.Fatal(err)
	}
	on, err = svc.AutoRefresh()
	if err != nil {
		t.Fatal(err)
	}
	if on {
		t.Fatal("want autoRefresh off after SetAutoRefresh(false)")
	}
}

func TestRefreshAllNoOpWithoutAttachedScheduler(t *testing.T) {
	store := openStore(t)
	mod := &fakeModule{manifests: []module.Manifest{widgetManifest()}}
	svc := NewService(store, newRegistry(t, mod), &recorder{})

	// Must not panic when no scheduler has been attached.
	svc.RefreshAll()
}

func TestRefreshAllKicksAttachedScheduler(t *testing.T) {
	store := openStore(t)
	mod := &fakeModule{manifests: []module.Manifest{widgetManifest()}}
	svc := NewService(store, newRegistry(t, mod), &recorder{})

	k := &fakeKicker{}
	svc.AttachScheduler(k)

	svc.RefreshAll()
	svc.RefreshAll()

	if k.kicks != 2 {
		t.Fatalf("want 2 kicks, got %d", k.kicks)
	}
}

func TestRefreshableWidgetIDs(t *testing.T) {
	ctx := context.Background()
	store := openStore(t)
	mod := &fakeModule{manifests: []module.Manifest{
		widgetManifest(), // type "widget", Refreshable: true
		{Type: "static", Title: "Static", Refreshable: false},
	}}
	svc := NewService(store, newRegistry(t, mod), &recorder{})

	// Refreshable, visible: included.
	if err := store.AddWidget(ctx, db.Widget{ID: "w1", Type: "widget", TabID: "default", Config: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	// Refreshable, hidden: excluded.
	if err := store.AddWidget(ctx, db.Widget{ID: "w2", Type: "widget", TabID: "default", Hidden: true, Config: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	// Refreshable: false in its manifest: excluded.
	if err := store.AddWidget(ctx, db.Widget{ID: "w3", Type: "static", TabID: "default", Config: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	// Unknown type: excluded.
	if err := store.AddWidget(ctx, db.Widget{ID: "w4", Type: "ghost", TabID: "default", Config: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}

	ids, err := svc.RefreshableWidgetIDs(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 1 || ids[0] != "w1" {
		t.Fatalf("want only [w1], got %v", ids)
	}
}

func TestDeleteTabLastTabErrorPassthrough(t *testing.T) {
	store := openStore(t)
	mod := &fakeModule{manifests: []module.Manifest{widgetManifest()}}
	svc := NewService(store, newRegistry(t, mod), &recorder{})

	err := svc.DeleteTab("default")
	if !errors.Is(err, db.ErrLastTab) {
		t.Fatalf("want db.ErrLastTab, got %v", err)
	}
}
