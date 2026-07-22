package bookmarks

import (
	"context"
	"fmt"

	"pulse/internal/module"
)

const LinksType = "bookmarks.links"

// Module is the widget-module contract implementation for bookmarks. It
// wraps a *Repo, which may be nil for manifest listing only (a live DB is
// not required to describe the widget type).
type Module struct{ repo *Repo }

// New wraps r as a bookmarks Module. r may be nil; Manifests() tolerates
// that, Fetch does not.
func New(r *Repo) *Module { return &Module{repo: r} }

func (Module) Manifests() []module.Manifest {
	return []module.Manifest{{
		Type:         LinksType,
		Title:        "Bookmarks",
		Refreshable:  false,
		ConfigFields: []module.ConfigField{},
	}}
}

func (m *Module) Fetch(ctx context.Context, widgetType string, config map[string]any) (any, error) {
	if m.repo == nil {
		return nil, fmt.Errorf("bookmarks: no repo configured")
	}
	rows, err := m.repo.List(ctx)
	if err != nil {
		return nil, err
	}
	return map[string]any{"bookmarks": rows}, nil
}
