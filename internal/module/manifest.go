// Package module defines the widget-module contract shared by all Pulse
// integrations: the config-field descriptor DSL, the Module interface every
// integration implements, config validation (a Go port of the frontend's
// Zod safeParse semantics), and the Registry that indexes modules by widget
// type and dispatches fetches.
//
// This package is pure contract: it must not import internal/db or
// internal/cli.
package module

import "context"

// FieldKind identifies the shape of a config field and, in turn, which
// form control frontend/src/components/schema-form.tsx renders for it.
type FieldKind string

const (
	FieldString         FieldKind = "string"
	FieldNumber         FieldKind = "number"
	FieldBoolean        FieldKind = "boolean"
	FieldStringList     FieldKind = "stringList"
	FieldEnum           FieldKind = "enum"
	FieldAsyncEnum      FieldKind = "asyncEnum"
	FieldAsyncMultiEnum FieldKind = "asyncMultiEnum"
)

// ConfigField describes one field of a widget's config. It serializes to
// exactly the Field shape frontend/src/components/schema-form.tsx already
// consumes: { key, label, kind, options?, optionsKey?, def? }.
type ConfigField struct {
	Key        string    `json:"key"`
	Label      string    `json:"label"`
	Kind       FieldKind `json:"kind"`
	Options    []string  `json:"options,omitempty"`    // enum only
	OptionsKey string    `json:"optionsKey,omitempty"` // asyncEnum/asyncMultiEnum only
	Default    any       `json:"def,omitempty"`
	Min, Max   *float64  `json:"-"` // number validation, backend-only
}

// Manifest describes one widget type a module offers.
type Manifest struct {
	Type         string        `json:"type"`
	Title        string        `json:"title"`
	ConfigFields []ConfigField `json:"configFields"`
	Refreshable  bool          `json:"refreshable"`
	Integration  string        `json:"integration,omitempty"`
}

// Module is the widget-module contract every integration implements.
type Module interface {
	Manifests() []Manifest
	Fetch(ctx context.Context, widgetType string, config map[string]any) (any, error)
}
