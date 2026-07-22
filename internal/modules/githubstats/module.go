package githubstats

import (
	"context"
	"fmt"
	"time"

	"pulse/internal/module"
	"pulse/internal/modules/github"
)

const (
	SummaryType = "github-stats.summary"
	HeatmapType = "github-stats.heatmap"
)

type Module struct{ run runner }

func New() *Module { return &Module{run: github.RunGh} }

func (Module) Manifests() []module.Manifest {
	return []module.Manifest{
		{
			Type: SummaryType, Title: "GitHub Stats", Refreshable: true, Integration: "github",
			ConfigFields: []module.ConfigField{
				{Key: "timeframe", Label: "Timeframe", Kind: module.FieldEnum,
					Options: []string{"7d", "30d", "90d", "year"}, Default: "30d"},
			},
		},
		{
			Type: HeatmapType, Title: "Contribution Heatmap", Refreshable: true, Integration: "github",
			ConfigFields: []module.ConfigField{},
		},
	}
}

type summaryConfig struct {
	Timeframe string `json:"timeframe"`
}

func (m *Module) Fetch(ctx context.Context, widgetType string, config map[string]any) (any, error) {
	switch widgetType {
	case SummaryType:
		cfg, err := module.DecodeConfig[summaryConfig](config)
		if err != nil {
			return nil, err
		}
		from, to := windowFor(cfg.Timeframe, time.Now())
		raw, err := fetchContributions(ctx, m.run, from, to)
		if err != nil {
			return nil, err
		}
		return toStatsData(raw), nil
	case HeatmapType:
		from, to := yearWindow(time.Now())
		raw, err := fetchContributions(ctx, m.run, from, to)
		if err != nil {
			return nil, err
		}
		return toHeatmapData(raw), nil
	}
	return nil, fmt.Errorf("githubstats: unknown widget type %s", widgetType)
}
