// Package dashboard is the core Wails-bound service: it composes db.Store
// and module.Registry into the layout/tab/pref CRUD and cache-first
// GetWidgetData the frontend calls directly (no HTTP boundary — Wails binds
// these methods straight onto the JS side).
package dashboard

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"pulse/internal/cli"
	"pulse/internal/db"
	"pulse/internal/module"
)

// Emitter decouples the service from the Wails runtime: main.go adapts the
// real app context, tests use a recorder. Required non-nil (see NewService)
// rather than nil-checked at every call site — there is no silent no-op mode.
type Emitter interface{ Emit(name string, data any) }

// EventCacheUpdated is emitted (with the widget id as data) after every
// widget_cache write GetWidgetData performs, success or error.
const EventCacheUpdated = "widget:cache-updated"

// Service is the core Wails-bound service composing the store and module
// registry. All bound methods use context.Background() internally — Wails
// invokes them directly, there is no request context to thread through.
type Service struct {
	store     *db.Store
	registry  *module.Registry
	emit      Emitter
	scheduler kicker // attached post-construction via AttachScheduler; nil until then
}

// NewService requires a non-nil Emitter; main.go passes the real Wails
// event adapter, tests pass a recorder.
func NewService(store *db.Store, reg *module.Registry, emit Emitter) *Service {
	if emit == nil {
		panic("dashboard: NewService requires a non-nil Emitter")
	}
	return &Service{store: store, registry: reg, emit: emit}
}

// LayoutSnapshot is the whole-board read model the frontend hydrates from
// on load.
type LayoutSnapshot struct {
	Widgets     []db.Widget `json:"widgets"`
	Tabs        []db.Tab    `json:"tabs"`
	ActiveTabID string      `json:"activeTabId"`
	Prefs       struct {
		Theme string `json:"theme"`
	} `json:"prefs"`
}

// WidgetPatch is a partial widget update. Config/Title/Accent are pointers
// so the caller can distinguish "field present" from "field absent"; because
// JSON also can't distinguish absent from explicit null for the nullable
// Title/Accent fields, SetTitle/SetAccent flag intent explicitly.
type WidgetPatch struct {
	Hidden *bool `json:"hidden,omitempty"`

	Config *json.RawMessage `json:"config,omitempty"`

	Title     *string `json:"title,omitempty"` // pointer-to-empty clears the override
	SetTitle  bool    `json:"setTitle,omitempty"`
	Accent    *string `json:"accent,omitempty"`
	SetAccent bool    `json:"setAccent,omitempty"`

	MoveToTab string `json:"moveToTab,omitempty"`
}

// UpdateResult reports the widget's post-patch state for the fields the
// frontend needs to reconcile locally without a full reload.
type UpdateResult struct {
	Config json.RawMessage `json:"config"`
	Title  *string         `json:"title"`
	Accent *string         `json:"accent"`
}

// Manifests returns every registered widget manifest.
func (s *Service) Manifests() []module.Manifest {
	return s.registry.Manifests()
}

// FieldOptions resolves the current options for an asyncEnum/asyncMultiEnum
// config field by its OptionsKey.
func (s *Service) FieldOptions(key string) ([]module.FieldOption, error) {
	return s.registry.FieldOptions(context.Background(), key)
}

// Layout reads the whole board: widgets, tabs, theme pref (default "dark"),
// and the active tab (saved pref if it still names an existing tab, else the
// first tab, else "default").
func (s *Service) Layout() (LayoutSnapshot, error) {
	ctx := context.Background()

	widgets, err := s.store.Widgets(ctx)
	if err != nil {
		return LayoutSnapshot{}, err
	}
	tabs, err := s.store.Tabs(ctx)
	if err != nil {
		return LayoutSnapshot{}, err
	}
	theme, err := s.store.Pref(ctx, "theme", "dark")
	if err != nil {
		return LayoutSnapshot{}, err
	}
	savedActiveTab, err := s.store.Pref(ctx, "ui.activeTab", "")
	if err != nil {
		return LayoutSnapshot{}, err
	}

	activeTabID := "default"
	saved := false
	for _, t := range tabs {
		if t.ID == savedActiveTab {
			saved = true
			break
		}
	}
	switch {
	case saved:
		activeTabID = savedActiveTab
	case len(tabs) > 0:
		activeTabID = tabs[0].ID
	}

	snapshot := LayoutSnapshot{Widgets: widgets, Tabs: tabs, ActiveTabID: activeTabID}
	snapshot.Prefs.Theme = theme
	return snapshot, nil
}

// CreateWidget adds a widget of widgetType (defaults from its manifest's
// config fields) to tabID (falling back to "default"), placed after every
// existing widget.
func (s *Service) CreateWidget(widgetType, tabID string) (db.Widget, error) {
	ctx := context.Background()

	manifest, ok := s.registry.Manifest(widgetType)
	if !ok {
		return db.Widget{}, fmt.Errorf("unknown widget type: %s", widgetType)
	}
	if tabID == "" {
		tabID = "default"
	}

	existing, err := s.store.Widgets(ctx)
	if err != nil {
		return db.Widget{}, err
	}
	order := 0
	for _, w := range existing {
		if w.Order+1 > order {
			order = w.Order + 1
		}
	}

	config, err := json.Marshal(module.DefaultConfig(manifest.ConfigFields))
	if err != nil {
		return db.Widget{}, err
	}

	w := db.Widget{
		ID:      uuid.NewString(),
		Type:    widgetType,
		Order:   order,
		ColSpan: 1,
		RowSpan: 6,
		Hidden:  false,
		TabID:   tabID,
		Config:  config,
	}
	if err := s.store.AddWidget(ctx, w); err != nil {
		return db.Widget{}, err
	}
	return w, nil
}

// UpdateWidget applies patch to widget id in order: Hidden, title
// (SetTitle), accent (SetAccent), tab move, then config — config is
// validated against the widget's manifest when the type is known (failure
// leaves the stored config untouched); an unknown type stores the patch
// verbatim, matching the TS service.
func (s *Service) UpdateWidget(id string, patch WidgetPatch) (UpdateResult, error) {
	ctx := context.Background()

	w, err := s.store.Widget(ctx, id)
	if err != nil {
		return UpdateResult{}, err
	}
	if w == nil {
		return UpdateResult{}, fmt.Errorf("widget not found: %s", id)
	}

	if patch.Hidden != nil {
		if err := s.store.SetHidden(ctx, id, *patch.Hidden); err != nil {
			return UpdateResult{}, err
		}
	}

	if patch.SetTitle {
		title := patch.Title
		if title != nil && *title == "" {
			title = nil
		}
		if err := s.store.SetTitle(ctx, id, title); err != nil {
			return UpdateResult{}, err
		}
	}

	if patch.SetAccent {
		if err := s.store.SetAccent(ctx, id, patch.Accent); err != nil {
			return UpdateResult{}, err
		}
	}

	if patch.MoveToTab != "" {
		if err := s.store.SetWidgetTab(ctx, id, patch.MoveToTab); err != nil {
			return UpdateResult{}, err
		}
	}

	if patch.Config != nil {
		if manifest, ok := s.registry.Manifest(w.Type); ok {
			normalized, err := module.ValidateConfig(manifest.ConfigFields, *patch.Config)
			if err != nil {
				return UpdateResult{}, err
			}
			raw, err := json.Marshal(normalized)
			if err != nil {
				return UpdateResult{}, err
			}
			if err := s.store.SetConfig(ctx, id, raw); err != nil {
				return UpdateResult{}, err
			}
		} else {
			if err := s.store.SetConfig(ctx, id, *patch.Config); err != nil {
				return UpdateResult{}, err
			}
		}
	}

	updated, err := s.store.Widget(ctx, id)
	if err != nil {
		return UpdateResult{}, err
	}
	if updated == nil {
		return UpdateResult{}, fmt.Errorf("widget not found: %s", id)
	}
	return UpdateResult{Config: updated.Config, Title: updated.Title, Accent: updated.Accent}, nil
}

// DeleteWidget removes a widget (and, via FK cascade, its cache row).
func (s *Service) DeleteWidget(id string) error {
	return s.store.RemoveWidget(context.Background(), id)
}

// SavePositions batch-applies order/colSpan/rowSpan after a drag-reorder.
func (s *Service) SavePositions(ps []db.Position) error {
	return s.store.SetPositions(context.Background(), ps)
}

// CreateTab adds a tab named name, placed after every existing tab.
func (s *Service) CreateTab(name string) (db.Tab, error) {
	ctx := context.Background()

	tabs, err := s.store.Tabs(ctx)
	if err != nil {
		return db.Tab{}, err
	}
	order := 0
	for _, t := range tabs {
		if t.Order+1 > order {
			order = t.Order + 1
		}
	}

	t := db.Tab{ID: uuid.NewString(), Name: name, Order: order}
	if err := s.store.AddTab(ctx, t); err != nil {
		return db.Tab{}, err
	}
	return t, nil
}

func (s *Service) RenameTab(id, name string) error {
	return s.store.RenameTab(context.Background(), id, name)
}

// DeleteTab removes a tab (and its widgets/cache via FK cascade).
// db.ErrLastTab passes through unchanged when id names the only tab.
func (s *Service) DeleteTab(id string) error {
	return s.store.DeleteTab(context.Background(), id)
}

func (s *Service) ReorderTabs(orders []db.TabOrder) error {
	return s.store.SetTabOrder(context.Background(), orders)
}

func (s *Service) SetActiveTab(id string) error {
	return s.store.SetPref(context.Background(), "ui.activeTab", id)
}

func (s *Service) SetTheme(theme string) error {
	return s.store.SetPref(context.Background(), "theme", theme)
}

// GetWidgetData is cache-first: refresh==false returns the cached row
// untouched when one exists. Otherwise (no cache row, or refresh==true) it
// runs the fetch, writing an "ok" row on success or an "error" row (with the
// previous payload preserved) on failure — including when the widget type
// is unknown or the stored config fails validation. Every cache write emits
// EventCacheUpdated.
func (s *Service) GetWidgetData(id string, refresh bool) (db.CacheRow, error) {
	ctx := context.Background()

	w, err := s.store.Widget(ctx, id)
	if err != nil {
		return db.CacheRow{}, err
	}
	if w == nil {
		return db.CacheRow{}, fmt.Errorf("widget not found: %s", id)
	}

	if !refresh {
		if row, err := s.store.CacheGet(ctx, id); err != nil {
			return db.CacheRow{}, err
		} else if row != nil {
			return *row, nil
		}
	}

	prev, err := s.store.CacheGet(ctx, id)
	if err != nil {
		return db.CacheRow{}, err
	}
	var prevPayload json.RawMessage
	if prev != nil {
		prevPayload = prev.Payload
	}

	manifest, known := s.registry.Manifest(w.Type)
	if !known {
		return s.cacheError(ctx, id, prevPayload, "Unknown widget type: "+w.Type, "failed")
	}
	config, err := module.ValidateConfig(manifest.ConfigFields, w.Config)
	if err != nil {
		return s.cacheError(ctx, id, prevPayload, "Invalid config — open Configure and re-save this widget.", "failed")
	}

	payload, err := s.registry.Fetch(ctx, w.Type, config)
	if err != nil {
		kind := "failed"
		var ce *cli.Error
		if errors.As(err, &ce) {
			kind = string(ce.Kind)
		}
		return s.cacheError(ctx, id, prevPayload, err.Error(), kind)
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return s.cacheError(ctx, id, prevPayload, err.Error(), "failed")
	}
	row, err := s.store.CacheSet(ctx, db.CacheRow{WidgetID: id, Status: "ok", Payload: raw})
	if err != nil {
		return db.CacheRow{}, err
	}
	s.emit.Emit(EventCacheUpdated, id)
	return row, nil
}

func (s *Service) cacheError(ctx context.Context, id string, prevPayload json.RawMessage, msg, kind string) (db.CacheRow, error) {
	row, err := s.store.CacheSet(ctx, db.CacheRow{
		WidgetID: id, Status: "error", Payload: prevPayload, Error: &msg, ErrorKind: &kind,
	})
	if err != nil {
		return db.CacheRow{}, err
	}
	s.emit.Emit(EventCacheUpdated, id)
	return row, nil
}
