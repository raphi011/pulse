// Package ccusage ports frontend/legacy-modules/ccusage: today's Claude
// spend via the ccusage CLI (process-model: JSON on stdout, errors via exit
// code; no auth concept — it reads local ~/.claude logs).
package ccusage

import (
	"context"
	"encoding/json"
	"time"

	"pulse/internal/cli"
	"pulse/internal/module"
)

const SpendType = "ccusage.spend"

func f64(v float64) *float64 { return &v }

// runner is the injectable CLI seam: returns stdout.
type runner func(ctx context.Context, args []string) (string, error)

func runCcusage(ctx context.Context, args []string) (string, error) {
	stdout, _, err := cli.Run(ctx, "ccusage", args, cli.Options{})
	return stdout, err
}

type Module struct{ run runner }

func New() *Module { return &Module{run: runCcusage} }

// SpendData mirrors the TS CcusageSpendData payload. Date is the local
// YYYY-MM-DD the cost covers.
type SpendData struct {
	CostUsd float64 `json:"costUsd"`
	Date    string  `json:"date"`
}

func (Module) Manifests() []module.Manifest {
	return []module.Manifest{{
		Type: SpendType, Title: "Claude Usage", Refreshable: true, Integration: "ccusage",
		ConfigFields: []module.ConfigField{
			{Key: "dailyLimitUsd", Label: "Daily limit (USD)", Kind: module.FieldNumber, Default: 20.0, Min: f64(0)},
		},
	}}
}

func (m *Module) Fetch(ctx context.Context, widgetType string, config map[string]any) (any, error) {
	now := time.Now()
	compact := now.Format("20060102")
	stdout, err := m.run(ctx, []string{"daily", "--json", "--since", compact, "--until", compact})
	if err != nil {
		return nil, err
	}
	var body struct {
		Totals struct {
			TotalCost float64 `json:"totalCost"`
		} `json:"totals"`
	}
	if err := json.Unmarshal([]byte(stdout), &body); err != nil {
		// A non-JSON preamble (e.g. an npx install banner) classifies like the
		// other CLI modules do, not as a raw parse error.
		return nil, &cli.Error{Kind: cli.KindFailed, Message: "ccusage returned non-JSON output"}
	}
	return SpendData{CostUsd: body.Totals.TotalCost, Date: now.Format("2006-01-02")}, nil
}
