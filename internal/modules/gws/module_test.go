package gws

import (
	"context"
	"testing"
)

func TestManifestsSevenTypesWithOptionsKeys(t *testing.T) {
	ms := New().Manifests()
	if len(ms) != 7 {
		t.Fatalf("want 7 manifests, got %d", len(ms))
	}
	byType := map[string][]int{}
	for i, m := range ms {
		byType[m.Type] = append(byType[m.Type], i)
		if m.Integration != "gws" || !m.Refreshable {
			t.Errorf("%s: integration/refreshable wrong", m.Type)
		}
	}
	for _, ty := range []string{GmailType, CalendarType, ChatDmsType, ChatChannelsType, DriveType, TasksType, NextMeetingType} {
		if len(byType[ty]) != 1 {
			t.Errorf("type %q registered %d times", ty, len(byType[ty]))
		}
	}
	// Spot-check optionsKey plumbing.
	for _, m := range ms {
		for _, f := range m.ConfigFields {
			if f.Key == "calendarId" && f.OptionsKey != CalendarsKey {
				t.Errorf("%s.calendarId optionsKey = %q", m.Type, f.OptionsKey)
			}
			if f.Key == "tasklist" && f.OptionsKey != TaskListsKey {
				t.Errorf("tasklist optionsKey = %q", f.OptionsKey)
			}
			if f.Key == "spaceIds" && f.OptionsKey != ChatSpacesKey {
				t.Errorf("spaceIds optionsKey = %q", f.OptionsKey)
			}
		}
	}
}

func TestFetchDispatch(t *testing.T) {
	m := New()
	m.run = func(ctx context.Context, args []string, out any) error { return nil }
	if _, err := m.Fetch(context.Background(), "gws.nope", nil); err == nil {
		t.Fatal("want error for unknown type")
	}
	got, err := m.Fetch(context.Background(), DriveType,
		map[string]any{"showDocs": true, "showSheets": true, "showSlides": true, "showOther": true, "limit": 25.0})
	if err != nil {
		t.Fatal(err)
	}
	if got.(DriveData).Files == nil {
		t.Fatal("files must be non-nil")
	}
}
