package gws

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

const eventsResp = `{"items":[
  {"id":"e1","status":"confirmed","summary":"Standup","htmlLink":"https://cal/e1",
   "hangoutLink":"https://meet/x",
   "start":{"dateTime":"2026-07-22T09:00:00+02:00"},"end":{"dateTime":"2026-07-22T09:15:00+02:00"},
   "attendees":[{"self":true,"responseStatus":"accepted"},{"responseStatus":"accepted"}]},
  {"id":"e2","status":"cancelled","summary":"Gone","start":{"dateTime":"2026-07-22T10:00:00+02:00"},
   "end":{"dateTime":"2026-07-22T11:00:00+02:00"}},
  {"id":"e3","summary":"Holiday","htmlLink":"https://cal/e3",
   "start":{"date":"2026-07-22"},"end":{"date":"2026-07-23"}}
]}`

func TestFetchCalendarFiltersCancelledAndFlagsAllDay(t *testing.T) {
	run := func(ctx context.Context, args []string, out any) error {
		return json.Unmarshal([]byte(eventsResp), out)
	}
	got, err := fetchCalendar(context.Background(), run, calendarConfig{CalendarID: "primary", Limit: 15})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Events) != 2 {
		t.Fatalf("cancelled event must drop; got %d events", len(got.Events))
	}
	if got.Events[0].AllDay || !got.Events[1].AllDay {
		t.Errorf("allDay flags wrong: %+v", got.Events)
	}
	if got.Events[0].MeetURL != "https://meet/x" {
		t.Errorf("meetUrl missing: %+v", got.Events[0])
	}
}

func TestIsMeetingEvent(t *testing.T) {
	timed := func() gEvent {
		var e gEvent
		e.Start = &gTime{DateTime: "2026-07-22T09:00:00Z"}
		e.End = &gTime{DateTime: "2026-07-22T10:00:00Z"}
		return e
	}
	allDay := timed()
	allDay.Start = &gTime{Date: "2026-07-22"}
	if isMeetingEvent(allDay, true) {
		t.Error("all-day events are never meetings")
	}

	declined := timed()
	declined.Attendees = []gAttendee{{Self: true, ResponseStatus: "declined"}}
	if isMeetingEvent(declined, true) {
		t.Error("declined events are not meetings")
	}

	solo := timed()
	if isMeetingEvent(solo, false) {
		t.Error("solo event without meet link excluded by default")
	}
	if !isMeetingEvent(solo, true) {
		t.Error("includeSoloEvents keeps solo events")
	}

	soloWithMeet := timed()
	soloWithMeet.HangoutLink = "https://meet/x"
	if !isMeetingEvent(soloWithMeet, false) {
		t.Error("a meet link makes a solo event a meeting")
	}
}

func TestFetchNextMeetingPagesAndFilters(t *testing.T) {
	pages := 0
	run := func(ctx context.Context, args []string, out any) error {
		pages++
		if pages == 1 {
			// params JSON is one arg; assert pageToken only appears on page 2+.
			if strings.Contains(args[len(args)-1], "pageToken") {
				t.Error("first page must not carry a pageToken")
			}
			return json.Unmarshal([]byte(`{"items":[],"nextPageToken":"p2"}`), out)
		}
		if !strings.Contains(args[len(args)-1], `"pageToken":"p2"`) {
			t.Error("second page must carry the token")
		}
		return json.Unmarshal([]byte(eventsResp), out)
	}
	got, err := fetchNextMeeting(context.Background(), run, nextMeetingConfig{CalendarID: "primary"})
	if err != nil {
		t.Fatal(err)
	}
	if pages != 2 {
		t.Fatalf("want 2 pages, got %d", pages)
	}
	// e1 is a real meeting; e2 cancelled; e3 all-day.
	if len(got.Meetings) != 1 || got.Meetings[0].ID != "e1" {
		t.Fatalf("meetings = %+v", got.Meetings)
	}
}

func TestDayWindowIsLocalMidnightToMidnight(t *testing.T) {
	now := time.Date(2026, 7, 22, 15, 30, 0, 0, time.Local)
	minStr, maxStr := dayWindow(now)
	min, err := time.Parse(time.RFC3339, minStr)
	if err != nil {
		t.Fatal(err)
	}
	max, err := time.Parse(time.RFC3339, maxStr)
	if err != nil {
		t.Fatal(err)
	}
	if max.Sub(min) != 24*time.Hour { // fixed non-DST date, so exactly 24h
		t.Errorf("window = %v..%v, want 24h", min, max)
	}
	local := min.In(time.Local)
	if local.Hour() != 0 || local.Minute() != 0 {
		t.Errorf("window start %v is not local midnight", local)
	}
}
