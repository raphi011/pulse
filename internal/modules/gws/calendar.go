package gws

import (
	"context"
	"time"
)

type gTime struct {
	DateTime string `json:"dateTime"`
	Date     string `json:"date"`
}
type gAttendee struct {
	Self           bool   `json:"self"`
	ResponseStatus string `json:"responseStatus"`
}
type gEvent struct {
	ID          string      `json:"id"`
	Status      string      `json:"status"`
	Summary     string      `json:"summary"`
	HTMLLink    string      `json:"htmlLink"`
	Location    string      `json:"location"`
	HangoutLink string      `json:"hangoutLink"`
	Start       *gTime      `json:"start"`
	End         *gTime      `json:"end"`
	Attendees   []gAttendee `json:"attendees"`
}
type eventListResp struct {
	Items         []gEvent `json:"items"`
	NextPageToken string   `json:"nextPageToken"`
}

// CalendarEventItem mirrors the TS CalendarEventItem payload shape.
type CalendarEventItem struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Start    string `json:"start"` // ISO datetime, or YYYY-MM-DD for all-day
	End      string `json:"end"`
	AllDay   bool   `json:"allDay"`
	Location string `json:"location,omitempty"`
	MeetURL  string `json:"meetUrl,omitempty"`
	URL      string `json:"url"` // htmlLink
}
type CalendarData struct {
	Events []CalendarEventItem `json:"events"`
}

// MeetingItem mirrors the TS MeetingItem payload shape (timed events only).
type MeetingItem struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Start   string `json:"start"`
	End     string `json:"end"`
	MeetURL string `json:"meetUrl,omitempty"`
	URL     string `json:"url"`
}

// NextMeetingData: all in-progress or not-yet-started qualifying meetings
// today, sorted by start (API order).
type NextMeetingData struct {
	Meetings []MeetingItem `json:"meetings"`
}

type calendarConfig struct {
	CalendarID string `json:"calendarId"`
	Limit      int    `json:"limit"`
}
type nextMeetingConfig struct {
	CalendarID        string `json:"calendarId"`
	IncludeSoloEvents bool   `json:"includeSoloEvents"`
}

func startStr(t *gTime) string {
	if t == nil {
		return ""
	}
	if t.DateTime != "" {
		return t.DateTime
	}
	return t.Date
}

func normalizeEvent(e gEvent) CalendarEventItem {
	title := e.Summary
	if title == "" {
		title = "(no title)"
	}
	return CalendarEventItem{
		ID: e.ID, Title: title,
		Start:    startStr(e.Start),
		End:      startStr(e.End),
		AllDay:   e.Start == nil || e.Start.DateTime == "", // all-day events carry `date`, not `dateTime`
		Location: e.Location, MeetURL: e.HangoutLink, URL: e.HTMLLink,
	}
}

// dayWindow: [local midnight, next local midnight) as absolute RFC3339 instants.
func dayWindow(now time.Time) (timeMin, timeMax string) {
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	end := start.AddDate(0, 0, 1)
	return start.UTC().Format(time.RFC3339), end.UTC().Format(time.RFC3339)
}

func fetchCalendar(ctx context.Context, run jsonRunner, cfg calendarConfig) (CalendarData, error) {
	timeMin, timeMax := dayWindow(time.Now())
	var resp eventListResp
	if err := run(ctx, []string{
		"calendar", "events", "list",
		"--params", jsonArg(map[string]any{
			"calendarId":   cfg.CalendarID,
			"timeMin":      timeMin,
			"timeMax":      timeMax,
			"singleEvents": true, // expand recurring events into instances
			"orderBy":      "startTime",
			"maxResults":   cfg.Limit,
		}),
	}, &resp); err != nil {
		return CalendarData{}, err
	}
	events := []CalendarEventItem{}
	for _, e := range resp.Items {
		if e.Status == "cancelled" {
			continue
		}
		events = append(events, normalizeEvent(e))
	}
	return CalendarData{Events: events}, nil
}

// listEvents pages through Calendar events for a window. `maxResults` caps
// *raw* events per page (all-day, declined, and solo events all count), so on
// a busy day the real next meeting can sit past the first page — follow
// nextPageToken, bounded against a misbehaving token.
func listEvents(ctx context.Context, run jsonRunner, params map[string]any) ([]gEvent, error) {
	items := []gEvent{}
	pageToken := ""
	for page := 0; page < 20; page++ {
		p := map[string]any{}
		for k, v := range params {
			p[k] = v
		}
		if pageToken != "" {
			p["pageToken"] = pageToken
		}
		var resp eventListResp
		if err := run(ctx, []string{"calendar", "events", "list", "--params", jsonArg(p)}, &resp); err != nil {
			return nil, err
		}
		items = append(items, resp.Items...)
		if resp.NextPageToken == "" {
			break
		}
		pageToken = resp.NextPageToken
	}
	return items, nil
}

// isMeetingEvent: a "real meeting" is timed, not cancelled, not declined by
// me, and not a solo event (no other attendees and no Meet link) unless
// includeSoloEvents.
func isMeetingEvent(e gEvent, includeSoloEvents bool) bool {
	if e.Status == "cancelled" {
		return false
	}
	if e.Start == nil || e.Start.DateTime == "" {
		return false // all-day events carry `date`, not `dateTime`
	}
	for _, a := range e.Attendees {
		if a.Self && a.ResponseStatus == "declined" {
			return false
		}
	}
	if !includeSoloEvents {
		others := 0
		for _, a := range e.Attendees {
			if !a.Self {
				others++
			}
		}
		if others == 0 && e.HangoutLink == "" {
			return false
		}
	}
	return true
}

func normalizeMeeting(e gEvent) MeetingItem {
	title := e.Summary
	if title == "" {
		title = "(no title)"
	}
	start, end := "", ""
	if e.Start != nil {
		start = e.Start.DateTime
	}
	if e.End != nil {
		end = e.End.DateTime
	}
	return MeetingItem{ID: e.ID, Title: title, Start: start, End: end, MeetURL: e.HangoutLink, URL: e.HTMLLink}
}

func fetchNextMeeting(ctx context.Context, run jsonRunner, cfg nextMeetingConfig) (NextMeetingData, error) {
	now := time.Now()
	_, timeMax := dayWindow(now)
	events, err := listEvents(ctx, run, map[string]any{
		"calendarId":   cfg.CalendarID,
		"timeMin":      now.UTC().Format(time.RFC3339), // in-progress events end after now, so they're included
		"timeMax":      timeMax,
		"singleEvents": true,
		"orderBy":      "startTime",
		"maxResults":   250,
	})
	if err != nil {
		return NextMeetingData{}, err
	}
	meetings := []MeetingItem{}
	for _, e := range events {
		if isMeetingEvent(e, cfg.IncludeSoloEvents) {
			meetings = append(meetings, normalizeMeeting(e))
		}
	}
	return NextMeetingData{Meetings: meetings}, nil
}
