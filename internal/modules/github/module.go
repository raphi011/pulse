package github

import (
	"context"
	"fmt"

	"pulse/internal/integration"
	"pulse/internal/module"
)

const (
	PrsType            = "github.prs"
	FailingActionsType = "github.failingActions"
	DependabotType     = "github.dependabot"
)

type Module struct{ run runner }

func New() *Module { return &Module{run: RunGh} }

func (Module) Manifests() []module.Manifest {
	return []module.Manifest{
		{
			Type: PrsType, Title: "Pull Requests", Refreshable: true, Integration: "github",
			ConfigFields: []module.ConfigField{
				{Key: "authors", Label: "GitHub usernames (blank = your PRs)", Kind: module.FieldStringList, Default: []string{}},
				{Key: "limit", Label: "Max PRs", Kind: module.FieldNumber, Default: 20.0, Min: f64(1), Max: f64(50)},
			},
		},
		{
			Type: FailingActionsType, Title: "Failing Actions", Refreshable: true, Integration: "github",
			ConfigFields: []module.ConfigField{
				{Key: "repos", Label: "Repos (owner/name)", Kind: module.FieldStringList, Default: []string{}},
				{Key: "limit", Label: "Max runs", Kind: module.FieldNumber, Default: 10.0, Min: f64(1), Max: f64(50)},
			},
		},
		{
			Type: DependabotType, Title: "Dependabot Alerts", Refreshable: true, Integration: "github",
			ConfigFields: []module.ConfigField{
				{Key: "repos", Label: "Repos (owner/name)", Kind: module.FieldStringList, Default: []string{}},
				{Key: "severity", Label: "Min severity", Kind: module.FieldEnum, Options: []string{"low", "medium", "high", "critical"}},
				{Key: "limit", Label: "Max alerts", Kind: module.FieldNumber, Default: 10.0, Min: f64(1), Max: f64(50)},
			},
		},
	}
}

func (m *Module) Fetch(ctx context.Context, widgetType string, config map[string]any) (any, error) {
	switch widgetType {
	case PrsType:
		cfg, err := module.DecodeConfig[prsConfig](config)
		if err != nil {
			return nil, err
		}
		return fetchPrs(ctx, m.run, cfg)
	case FailingActionsType:
		cfg, err := module.DecodeConfig[failingActionsConfig](config)
		if err != nil {
			return nil, err
		}
		return fetchFailingActions(ctx, m.run, cfg)
	case DependabotType:
		cfg, err := module.DecodeConfig[dependabotConfig](config)
		if err != nil {
			return nil, err
		}
		return fetchDependabot(ctx, m.run, cfg)
	}
	return nil, fmt.Errorf("github: unknown widget type %s", widgetType)
}

// Integration describes the github CLI for the integrations panel; the
// probe is a cheap authenticated call.
func Integration() integration.Integration {
	return integration.Integration{
		ID: "github", Name: "GitHub",
		Tool: &integration.Tool{
			Bin:         "gh",
			InstallHint: "Install the GitHub CLI — https://cli.github.com (`brew install gh`).",
			AuthHint:    "Run `gh auth login` to authenticate.",
		},
		Probe: func(ctx context.Context) error {
			_, err := RunGh(ctx, []string{"auth", "status"})
			return err
		},
	}
}
