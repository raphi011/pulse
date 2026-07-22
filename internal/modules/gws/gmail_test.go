package gws

import (
	"context"
	"encoding/json"
	"sync/atomic"
	"testing"

	"pulse/internal/cli"
)

// fakeRun decodes canned JSON into out, routed by a key derived from args.
// Route key: first three args joined ("gmail users messages" list vs get is
// disambiguated by the 4th arg).
func fakeRun(t *testing.T, responses map[string]string) jsonRunner {
	t.Helper()
	return func(ctx context.Context, args []string, out any) error {
		key := args[0] + " " + args[1] + " " + args[2] + " " + args[3]
		resp, ok := responses[key]
		if !ok {
			t.Fatalf("unexpected gws args: %v", args)
		}
		return json.Unmarshal([]byte(resp), out)
	}
}

const gmailList = `{"messages":[{"id":"m1","threadId":"t1"},{"id":"m2","threadId":"t2"}]}`
const gmailMsg1 = `{"id":"m1","labelIds":["UNREAD","INBOX"],"internalDate":"1753113600000",
  "payload":{"headers":[{"name":"Subject","value":"Hello"},{"name":"From","value":"\"Jane Doe\" <jane@x.com>"}]}}`

func TestParseFrom(t *testing.T) {
	cases := []struct{ in, want string }{
		{`"Jane Doe" <jane@x.com>`, "Jane Doe"},
		{`Jane Doe <jane@x.com>`, "Jane Doe"},
		{`jane@x.com`, "jane@x.com"},
		{`<jane@x.com>`, "<jane@x.com>"},
	}
	for _, c := range cases {
		if got := parseFrom(c.in); got != c.want {
			t.Errorf("parseFrom(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestFetchGmailEnrichesEachMessage(t *testing.T) {
	run := fakeRun(t, map[string]string{
		"gmail users messages list": gmailList,
		"gmail users messages get":  gmailMsg1,
	})
	got, err := fetchGmail(context.Background(), run, gmailConfig{Query: "is:unread", Limit: 15})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Emails) != 2 {
		t.Fatalf("want 2 emails, got %d", len(got.Emails))
	}
	e := got.Emails[0]
	if e.Subject != "Hello" || e.From != "Jane Doe" || !e.Unread {
		t.Errorf("normalize wrong: %+v", e)
	}
	if e.URL != "https://mail.google.com/mail/u/0/#all/m1" {
		t.Errorf("url = %q (must use #all/, not #inbox/)", e.URL)
	}
	if e.Date == "" {
		t.Error("internalDate ms must convert to an ISO date")
	}
}

func TestFetchGmailPartialFailureListsIDs(t *testing.T) {
	var calls atomic.Int32
	run := func(ctx context.Context, args []string, out any) error {
		if args[3] == "list" {
			return json.Unmarshal([]byte(gmailList), out)
		}
		calls.Add(1)
		if calls.Load() == 1 {
			return &cli.Error{Kind: cli.KindFailed, Message: "boom"}
		}
		return json.Unmarshal([]byte(gmailMsg1), out)
	}
	got, err := fetchGmail(context.Background(), run, gmailConfig{Query: "q", Limit: 15})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Emails) != 1 || len(got.Errors) != 1 {
		t.Fatalf("want 1 email + 1 error, got %d/%d", len(got.Emails), len(got.Errors))
	}
}

func TestFetchGmailEmptyListYieldsEmptyNonNil(t *testing.T) {
	run := fakeRun(t, map[string]string{"gmail users messages list": `{}`})
	got, err := fetchGmail(context.Background(), run, gmailConfig{Query: "q", Limit: 15})
	if err != nil {
		t.Fatal(err)
	}
	if got.Emails == nil || len(got.Emails) != 0 {
		t.Fatalf("want empty non-nil emails, got %#v", got.Emails)
	}
}
