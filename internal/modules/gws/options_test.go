package gws

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestFieldOptionsKeysRegistered(t *testing.T) {
	opts := New().FieldOptions()
	for _, key := range []string{TaskListsKey, CalendarsKey, ChatSpacesKey} {
		if _, ok := opts[key]; !ok {
			t.Errorf("missing options provider for %q", key)
		}
	}
}

func TestCalendarOptionsLabelPrimary(t *testing.T) {
	run := func(ctx context.Context, args []string, out any) error {
		return json.Unmarshal([]byte(`{"items":[
			{"id":"primary-id","summary":"Me","primary":true},
			{"id":"team-id","summary":"Team"}]}`), out)
	}
	got, err := fetchCalendarOptions(context.Background(), run)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Label != "Me (primary)" || got[1].Label != "Team" {
		t.Fatalf("options = %+v", got)
	}
}

func TestChatSpaceOptionsPageAndLabelDMs(t *testing.T) {
	pages := 0
	run := func(ctx context.Context, args []string, out any) error {
		pages++
		if pages == 1 {
			return json.Unmarshal([]byte(`{"spaces":[
				{"name":"spaces/A","displayName":"Eng"}],"nextPageToken":"p2"}`), out)
		}
		if !strings.Contains(args[len(args)-1], `"pageToken":"p2"`) {
			t.Error("second page must carry the token")
		}
		return json.Unmarshal([]byte(`{"spaces":[
			{"name":"spaces/B","spaceType":"DIRECT_MESSAGE"}]}`), out)
	}
	got, err := fetchChatSpaceOptions(context.Background(), run)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Label != "Eng" || got[1].Label != "Direct message" {
		t.Fatalf("options = %+v", got)
	}
}

func TestTaskListOptions(t *testing.T) {
	run := func(ctx context.Context, args []string, out any) error {
		return json.Unmarshal([]byte(`{"items":[{"id":"l1","title":"Inbox"},{"id":"l2"}]}`), out)
	}
	got, err := fetchTaskListOptions(context.Background(), run)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Label != "Inbox" || got[1].Label != "l2" {
		t.Fatalf("options = %+v", got)
	}
}
