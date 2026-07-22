package gws

import (
	"context"

	"pulse/internal/module"
)

// Field-options provider keys (mirrors the TS option-keys.ts values — the
// frontend resolves them via Dashboard.FieldOptions).
const (
	TaskListsKey  = "gws.taskLists"
	CalendarsKey  = "gws.calendars"
	ChatSpacesKey = "gws.chatSpaces"
)

func fetchTaskListOptions(ctx context.Context, run jsonRunner) ([]module.FieldOption, error) {
	var resp struct {
		Items []struct {
			ID    string `json:"id"`
			Title string `json:"title"`
		} `json:"items"`
	}
	if err := run(ctx, []string{"tasks", "tasklists", "list"}, &resp); err != nil {
		return nil, err
	}
	out := []module.FieldOption{}
	for _, t := range resp.Items {
		label := t.Title
		if label == "" {
			label = t.ID
		}
		out = append(out, module.FieldOption{Value: t.ID, Label: label})
	}
	return out, nil
}

func fetchCalendarOptions(ctx context.Context, run jsonRunner) ([]module.FieldOption, error) {
	var resp struct {
		Items []struct {
			ID      string `json:"id"`
			Summary string `json:"summary"`
			Primary bool   `json:"primary"`
		} `json:"items"`
	}
	if err := run(ctx, []string{"calendar", "calendarList", "list"}, &resp); err != nil {
		return nil, err
	}
	out := []module.FieldOption{}
	for _, c := range resp.Items {
		label := c.Summary
		if label == "" {
			label = c.ID
		}
		if c.Primary {
			label += " (primary)"
		}
		out = append(out, module.FieldOption{Value: c.ID, Label: label})
	}
	return out, nil
}

// fetchChatSpaceOptions pages through all chat spaces so the options list
// isn't silently capped at the API's page size; page count is bounded
// against a misbehaving nextPageToken.
func fetchChatSpaceOptions(ctx context.Context, run jsonRunner) ([]module.FieldOption, error) {
	all := []chatSpace{}
	pageToken := ""
	for page := 0; page < 20; page++ {
		params := map[string]any{"pageSize": 1000}
		if pageToken != "" {
			params["pageToken"] = pageToken
		}
		var resp spacesResp
		if err := run(ctx, []string{"chat", "spaces", "list", "--params", jsonArg(params)}, &resp); err != nil {
			return nil, err
		}
		all = append(all, resp.Spaces...)
		if resp.NextPageToken == "" {
			break
		}
		pageToken = resp.NextPageToken
	}
	out := []module.FieldOption{}
	for _, s := range all {
		// DMs carry no displayName — label them clearly instead of surfacing
		// the raw "spaces/…" id.
		label := s.DisplayName
		if label == "" {
			if s.SpaceType == "DIRECT_MESSAGE" {
				label = "Direct message"
			} else {
				label = s.Name
			}
		}
		out = append(out, module.FieldOption{Value: s.Name, Label: label})
	}
	return out, nil
}

// FieldOptions implements module.OptionsSource.
func (m *Module) FieldOptions() map[string]module.OptionsProvider {
	return map[string]module.OptionsProvider{
		TaskListsKey: func(ctx context.Context) ([]module.FieldOption, error) {
			return fetchTaskListOptions(ctx, m.run)
		},
		CalendarsKey: func(ctx context.Context) ([]module.FieldOption, error) {
			return fetchCalendarOptions(ctx, m.run)
		},
		ChatSpacesKey: func(ctx context.Context) ([]module.FieldOption, error) {
			return fetchChatSpaceOptions(ctx, m.run)
		},
	}
}
