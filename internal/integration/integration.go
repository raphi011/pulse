// Package integration ports src/server/integration-service.ts: per-CLI
// health probes with a TTL cache and in-flight dedup, and enable/disable
// with a widget-delete confirm step.
package integration

import (
	"context"
	"errors"

	"pulse/internal/cli"
)

// Tool describes the CLI an integration depends on.
type Tool struct {
	Bin         string `json:"bin"`
	InstallHint string `json:"installHint"`
	AuthHint    string `json:"authHint"`
}

// Integration is one registered integration; Probe is a lightweight
// authenticated CLI call (or a version check for NoAuth tools).
type Integration struct {
	ID     string
	Name   string
	Tool   *Tool
	NoAuth bool
	Probe  func(ctx context.Context) error
}

// Health mirrors the TS IntegrationHealth contract. Authed is true, false,
// or the string "n/a" (tools with no auth concept).
type Health struct {
	Installed bool   `json:"installed"`
	Authed    any    `json:"authed"`
	Detail    string `json:"detail,omitempty"`
}

// Status mirrors the TS IntegrationStatus contract.
type Status struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Tool        *Tool  `json:"tool"`
	Health      Health `json:"health"`
	Enabled     bool   `json:"enabled"`
	Override    *bool  `json:"override"`
	WidgetCount int    `json:"widgetCount"`
}

// probeHealth runs the probe and classifies. A not-found cli.Error means the
// tool isn't installed; any other failure means installed but auth
// unconfirmed (for NoAuth tools that isn't an auth problem, so Authed stays
// "n/a" with the failure in Detail).
func probeHealth(ctx context.Context, integ Integration) Health {
	authedOK := any(true)
	if integ.NoAuth {
		authedOK = "n/a"
	}
	err := integ.Probe(ctx)
	if err == nil {
		return Health{Installed: true, Authed: authedOK}
	}
	var ce *cli.Error
	if errors.As(err, &ce) && ce.Kind == cli.KindNotFound {
		return Health{Installed: false, Authed: false, Detail: err.Error()}
	}
	authed := any(false)
	if integ.NoAuth {
		authed = "n/a"
	}
	return Health{Installed: true, Authed: authed, Detail: err.Error()}
}

// resolveEnabled: an explicit override wins; otherwise enabled unless the
// tool exists but isn't installed.
func resolveEnabled(hasTool, installed bool, override *bool) bool {
	if override != nil {
		return *override
	}
	return !hasTool || installed
}
