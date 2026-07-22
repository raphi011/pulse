package module

import (
	"context"
	"fmt"
)

// Registry indexes the widget manifests and async field-options providers
// contributed by a fixed set of modules, and dispatches fetches to the
// module that owns each widget type.
type Registry struct {
	mods    []Module
	byType  map[string]Module
	options map[string]OptionsProvider
}

// NewRegistry indexes the manifests and field-options providers of mods.
// It errors if two modules register the same widget type, or two modules
// (or two fields within one module) register the same options key.
func NewRegistry(mods ...Module) (*Registry, error) {
	r := &Registry{
		mods:    mods,
		byType:  map[string]Module{},
		options: map[string]OptionsProvider{},
	}

	for _, mod := range mods {
		for _, m := range mod.Manifests() {
			if _, exists := r.byType[m.Type]; exists {
				return nil, fmt.Errorf("duplicate widget type: %s", m.Type)
			}
			r.byType[m.Type] = mod
		}

		src, ok := mod.(OptionsSource)
		if !ok {
			continue
		}
		for key, provider := range src.FieldOptions() {
			if _, exists := r.options[key]; exists {
				return nil, fmt.Errorf("duplicate options key: %s", key)
			}
			r.options[key] = provider
		}
	}

	return r, nil
}

// Manifests returns every registered manifest in registration order.
func (r *Registry) Manifests() []Manifest {
	out := []Manifest{}
	for _, mod := range r.mods {
		out = append(out, mod.Manifests()...)
	}
	return out
}

// Manifest looks up a single widget type's manifest.
func (r *Registry) Manifest(widgetType string) (Manifest, bool) {
	mod, ok := r.byType[widgetType]
	if !ok {
		return Manifest{}, false
	}
	for _, m := range mod.Manifests() {
		if m.Type == widgetType {
			return m, true
		}
	}
	return Manifest{}, false
}

// Fetch dispatches to the module owning widgetType.
func (r *Registry) Fetch(ctx context.Context, widgetType string, config map[string]any) (any, error) {
	mod, ok := r.byType[widgetType]
	if !ok {
		return nil, fmt.Errorf("unknown widget type: %s", widgetType)
	}
	return mod.Fetch(ctx, widgetType, config)
}

// FieldOptions resolves the current options for an asyncEnum/
// asyncMultiEnum field by its OptionsKey. An unknown key returns an empty,
// non-nil slice and a nil error.
func (r *Registry) FieldOptions(ctx context.Context, key string) ([]FieldOption, error) {
	provider, ok := r.options[key]
	if !ok {
		return []FieldOption{}, nil
	}
	return provider(ctx)
}
