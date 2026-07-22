package gws

import (
	"context"
	"fmt"

	"pulse/internal/integration"
	"pulse/internal/module"
)

const (
	GmailType        = "gws.gmail"
	CalendarType     = "gws.calendar"
	ChatDmsType      = "gws.chatDms"
	ChatChannelsType = "gws.chatChannels"
	DriveType        = "gws.drive"
	TasksType        = "gws.tasks"
	NextMeetingType  = "gws.nextMeeting"
)

func f64(v float64) *float64 { return &v }

type Module struct{ run jsonRunner }

func New() *Module { return &Module{run: runGwsJSON} }

func (Module) Manifests() []module.Manifest {
	return []module.Manifest{
		{
			Type: GmailType, Title: "Gmail", Refreshable: true, Integration: "gws",
			ConfigFields: []module.ConfigField{
				{Key: "query", Label: "Gmail search query", Kind: module.FieldString, Default: "is:unread in:inbox"},
				{Key: "limit", Label: "Max emails", Kind: module.FieldNumber, Default: 15.0, Min: f64(1), Max: f64(50)},
			},
		},
		{
			Type: CalendarType, Title: "Calendar", Refreshable: true, Integration: "gws",
			ConfigFields: []module.ConfigField{
				{Key: "calendarId", Label: "Calendar", Kind: module.FieldAsyncEnum, OptionsKey: CalendarsKey, Default: "primary"},
				{Key: "limit", Label: "Max events", Kind: module.FieldNumber, Default: 15.0, Min: f64(1), Max: f64(50)},
			},
		},
		{
			Type: ChatDmsType, Title: "Unread DMs", Refreshable: true, Integration: "gws",
			ConfigFields: []module.ConfigField{
				{Key: "limit", Label: "Max recent DMs to scan", Kind: module.FieldNumber, Default: 15.0, Min: f64(1), Max: f64(50)},
			},
		},
		{
			Type: ChatChannelsType, Title: "Chat Channels", Refreshable: true, Integration: "gws",
			ConfigFields: []module.ConfigField{
				{Key: "spaceIds", Label: "Spaces", Kind: module.FieldAsyncMultiEnum, OptionsKey: ChatSpacesKey, Default: []string{}},
			},
		},
		{
			Type: DriveType, Title: "Starred files", Refreshable: true, Integration: "gws",
			ConfigFields: []module.ConfigField{
				{Key: "showDocs", Label: "Show Docs", Kind: module.FieldBoolean, Default: true},
				{Key: "showSheets", Label: "Show Sheets", Kind: module.FieldBoolean, Default: true},
				{Key: "showSlides", Label: "Show Slides", Kind: module.FieldBoolean, Default: true},
				{Key: "showOther", Label: "Show other files", Kind: module.FieldBoolean, Default: true},
				{Key: "limit", Label: "Max files", Kind: module.FieldNumber, Default: 25.0, Min: f64(1), Max: f64(100)},
			},
		},
		{
			Type: TasksType, Title: "Tasks", Refreshable: true, Integration: "gws",
			ConfigFields: []module.ConfigField{
				{Key: "tasklist", Label: "Task list", Kind: module.FieldAsyncEnum, OptionsKey: TaskListsKey, Default: "@default"},
				{Key: "showCompleted", Label: "Show completed tasks", Kind: module.FieldBoolean, Default: false},
				{Key: "completedMaxAge", Label: "Show completed up to (only when completed shown)", Kind: module.FieldEnum,
					Options: []string{"Today", "Last 7 days", "Last 30 days", "All time"}, Default: "All time"},
				{Key: "limit", Label: "Max tasks", Kind: module.FieldNumber, Default: 25.0, Min: f64(1), Max: f64(100)},
			},
		},
		{
			Type: NextMeetingType, Title: "Next meeting", Refreshable: true, Integration: "gws",
			ConfigFields: []module.ConfigField{
				{Key: "calendarId", Label: "Calendar", Kind: module.FieldAsyncEnum, OptionsKey: CalendarsKey, Default: "primary"},
				{Key: "includeSoloEvents", Label: "Count solo events (no other attendees, no Meet link)", Kind: module.FieldBoolean, Default: false},
			},
		},
	}
}

func (m *Module) Fetch(ctx context.Context, widgetType string, config map[string]any) (any, error) {
	switch widgetType {
	case GmailType:
		cfg, err := module.DecodeConfig[gmailConfig](config)
		if err != nil {
			return nil, err
		}
		return fetchGmail(ctx, m.run, cfg)
	case CalendarType:
		cfg, err := module.DecodeConfig[calendarConfig](config)
		if err != nil {
			return nil, err
		}
		return fetchCalendar(ctx, m.run, cfg)
	case ChatDmsType:
		cfg, err := module.DecodeConfig[chatDmsConfig](config)
		if err != nil {
			return nil, err
		}
		return fetchChatDms(ctx, m.run, cfg)
	case ChatChannelsType:
		cfg, err := module.DecodeConfig[chatChannelsConfig](config)
		if err != nil {
			return nil, err
		}
		return fetchChatChannels(ctx, m.run, cfg)
	case DriveType:
		cfg, err := module.DecodeConfig[driveConfig](config)
		if err != nil {
			return nil, err
		}
		return fetchDrive(ctx, m.run, cfg)
	case TasksType:
		cfg, err := module.DecodeConfig[tasksConfig](config)
		if err != nil {
			return nil, err
		}
		return fetchTasks(ctx, m.run, cfg)
	case NextMeetingType:
		cfg, err := module.DecodeConfig[nextMeetingConfig](config)
		if err != nil {
			return nil, err
		}
		return fetchNextMeeting(ctx, m.run, cfg)
	}
	return nil, fmt.Errorf("gws: unknown widget type %s", widgetType)
}

func Integration() integration.Integration {
	return integration.Integration{
		ID: "gws", Name: "Google Workspace",
		Tool: &integration.Tool{
			Bin:         "gws",
			InstallHint: "Install the `gws` CLI and configure OAuth credentials.",
			AuthHint:    "Run `gws auth login` to authenticate.",
		},
		// getProfile is a cheap authenticated Gmail call — 401 when unauthenticated.
		Probe: func(ctx context.Context) error {
			var out map[string]any
			return runGwsJSON(ctx, []string{
				"gmail", "users", "getProfile", "--params", jsonArg(map[string]any{"userId": "me"}),
			}, &out)
		},
	}
}
