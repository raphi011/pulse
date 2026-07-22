package system

import (
	"context"

	"pulse/internal/module"
)

const StatsType = "system.stats"

func f64(v float64) *float64 { return &v }

type Module struct{}

func New() *Module { return &Module{} }

func (Module) Manifests() []module.Manifest {
	return []module.Manifest{{
		Type: StatsType, Title: "System", Refreshable: false,
		ConfigFields: []module.ConfigField{
			{Key: "sampleIntervalSeconds", Label: "Sample interval (seconds)", Kind: module.FieldNumber, Default: 2.0, Min: f64(1), Max: f64(10)},
			{Key: "historySeconds", Label: "History window (seconds)", Kind: module.FieldNumber, Default: 120.0, Min: f64(30), Max: f64(600)},
		},
	}}
}

// Live widget: data flows through the sampler service, not the cache.
func (Module) Fetch(ctx context.Context, widgetType string, config map[string]any) (any, error) {
	return struct{}{}, nil
}
