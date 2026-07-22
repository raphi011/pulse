package pomodoro

import (
	"context"

	"pulse/internal/module"
)

const TimerType = "pomodoro.timer"

func f64(v float64) *float64 { return &v }

type Module struct{}

func New() *Module { return &Module{} }

func (Module) Manifests() []module.Manifest {
	return []module.Manifest{{
		Type: TimerType, Title: "Pomodoro", Refreshable: false,
		ConfigFields: []module.ConfigField{
			{Key: "workMinutes", Label: "Work (minutes)", Kind: module.FieldNumber, Default: 25.0, Min: f64(1), Max: f64(180)},
			{Key: "shortBreakMinutes", Label: "Short break (minutes)", Kind: module.FieldNumber, Default: 5.0, Min: f64(1), Max: f64(60)},
			{Key: "longBreakMinutes", Label: "Long break (minutes)", Kind: module.FieldNumber, Default: 15.0, Min: f64(1), Max: f64(60)},
			{Key: "pomodorosPerLongBreak", Label: "Pomodoros per long break", Kind: module.FieldNumber, Default: 4.0, Min: f64(1), Max: f64(12)},
		},
	}}
}

// Live widget: state lives in the frontend engine; the cache pipeline
// carries no data.
func (Module) Fetch(ctx context.Context, widgetType string, config map[string]any) (any, error) {
	return struct{}{}, nil
}
