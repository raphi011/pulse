package gws

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"pulse/internal/cli"
)

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile("testdata/chat/" + name)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestIsUnread(t *testing.T) {
	cases := []struct {
		name, active, read string
		want               bool
	}{
		{"no messages yet", "", "2026-07-20T10:00:00Z", false},
		{"never read", "2026-07-20T10:00:00Z", "", true},
		{"newer message", "2026-07-20T10:00:00Z", "2026-07-19T10:00:00Z", true},
		{"already read", "2026-07-19T10:00:00Z", "2026-07-20T10:00:00Z", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := isUnread(c.active, c.read); got != c.want {
				t.Errorf("isUnread(%q,%q) = %v, want %v", c.active, c.read, got, c.want)
			}
		})
	}
}

func TestCallerUserIDAndPeopleResource(t *testing.T) {
	if got := callerUserID("users/12345/spaces/AAAA/spaceReadState"); got != "users/12345" {
		t.Errorf("callerUserID = %q", got)
	}
	if got := callerUserID("bogus"); got != "" {
		t.Errorf("callerUserID(bogus) = %q, want empty", got)
	}
	if got := peopleResourceName("users/12345"); got != "people/12345" {
		t.Errorf("peopleResourceName = %q", got)
	}
	if got := peopleResourceName(""); got != "" {
		t.Errorf("peopleResourceName(empty) = %q, want empty", got)
	}
}

// chatRunner serves the fixture set: spaces list → dm-spaces, read state →
// space-read-state, messages list → messages-latest, people batch → people-get.
func chatRunner(t *testing.T) jsonRunner {
	t.Helper()
	return func(ctx context.Context, args []string, out any) error {
		switch {
		case args[0] == "chat" && args[1] == "spaces" && args[2] == "list":
			return json.Unmarshal(fixture(t, "dm-spaces.json"), out)
		case args[0] == "chat" && args[1] == "users":
			return json.Unmarshal(fixture(t, "space-read-state.json"), out)
		case args[0] == "chat" && args[1] == "spaces" && args[2] == "messages":
			return json.Unmarshal(fixture(t, "messages-latest.json"), out)
		case args[0] == "chat" && args[1] == "spaces" && args[2] == "get":
			return json.Unmarshal(fixture(t, "space-get.json"), out)
		case args[0] == "people":
			return json.Unmarshal(fixture(t, "people-get.json"), out)
		}
		t.Fatalf("unexpected gws args: %v", args)
		return nil
	}
}

func TestFetchChatDmsEndToEndAgainstFixtures(t *testing.T) {
	got, err := fetchChatDms(context.Background(), chatRunner(t), chatDmsConfig{Limit: 15})
	if err != nil {
		t.Fatal(err)
	}
	if got.Dms == nil {
		t.Fatal("dms must be non-nil")
	}
	for _, dm := range got.Dms {
		if dm.SpaceID == "" || dm.Partner == "" {
			t.Errorf("unnormalized dm: %+v", dm)
		}
	}
}

func TestFetchChatChannelsStaleIDGoesToErrors(t *testing.T) {
	good := chatRunner(t)
	// Fail every call whose --params mentions the stale space id.
	run := func(ctx context.Context, args []string, out any) error {
		for _, a := range args {
			if strings.Contains(a, "spaces/stale") {
				return &cli.Error{Kind: cli.KindFailed, Message: "boom"}
			}
		}
		return good(ctx, args, out)
	}
	got, err := fetchChatChannels(context.Background(), run, chatChannelsConfig{SpaceIDs: []string{"spaces/AAAA", "spaces/stale"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Errors) != 1 || got.Errors[0] != "spaces/stale" {
		t.Fatalf("Errors = %v, want [spaces/stale]", got.Errors)
	}
	if len(got.Channels) != 1 {
		t.Fatalf("want the good channel to survive, got %+v", got.Channels)
	}
}
