package jira

import (
	"context"
	"fmt"

	"pulse/internal/integration"
	"pulse/internal/module"
)

const JqlType = "jira.jql"

func f64(v float64) *float64 { return &v }

// Pointer receiver required: Module embeds a sync.Mutex, so a value receiver
// would copy the lock (go vet copylocks).
func (m *Module) Manifests() []module.Manifest {
	return []module.Manifest{{
		Type: JqlType, Title: "Jira Query", Refreshable: true, Integration: "jira",
		ConfigFields: []module.ConfigField{
			{Key: "jql", Label: "JQL", Kind: module.FieldString,
				Default: "assignee = currentUser() AND resolution = EMPTY"},
			{Key: "limit", Label: "Max issues", Kind: module.FieldNumber, Default: 10.0, Min: f64(1), Max: f64(100)},
		},
	}}
}

func (m *Module) Fetch(ctx context.Context, widgetType string, config map[string]any) (any, error) {
	if widgetType != JqlType {
		return nil, fmt.Errorf("jira: unknown widget type %s", widgetType)
	}
	cfg, err := module.DecodeConfig[jqlConfig](config)
	if err != nil {
		return nil, err
	}
	return m.fetchJql(ctx, cfg)
}

func Integration() integration.Integration {
	return integration.Integration{
		ID: "jira", Name: "Jira",
		Tool: &integration.Tool{
			Bin:         "jira",
			InstallHint: "Install jira-cli — https://github.com/ankitpokhrel/jira-cli (`brew install ankitpokhrel/jira-cli/jira-cli`).",
			AuthHint:    "Run `jira init` and set the `JIRA_API_TOKEN` environment variable.",
		},
		Probe: func(ctx context.Context) error {
			_, err := runJira(ctx, []string{"me"})
			return err
		},
	}
}
