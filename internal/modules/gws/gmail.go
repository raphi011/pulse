package gws

import (
	"context"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

// EmailItem mirrors the TS EmailItem payload shape.
type EmailItem struct {
	ID      string `json:"id"`
	Subject string `json:"subject"`
	From    string `json:"from"`
	Date    string `json:"date"` // ISO timestamp ("" if unknown)
	Unread  bool   `json:"unread"`
	URL     string `json:"url"` // Gmail deep link
}

// GmailData.Errors: ids of messages whose per-item fetch failed.
type GmailData struct {
	Emails []EmailItem `json:"emails"`
	Errors []string    `json:"errors,omitempty"`
}

type gmailConfig struct {
	Query string `json:"query"`
	Limit int    `json:"limit"`
}

type gmailHeader struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}
type gmailMsg struct {
	ID           string   `json:"id"`
	LabelIDs     []string `json:"labelIds"`
	InternalDate string   `json:"internalDate"` // epoch millis, as a string
	Payload      *struct {
		Headers []gmailHeader `json:"headers"`
	} `json:"payload"`
}

func header(msg gmailMsg, name string) string {
	if msg.Payload == nil {
		return ""
	}
	for _, h := range msg.Payload.Headers {
		if strings.EqualFold(h.Name, name) {
			return h.Value
		}
	}
	return ""
}

var fromRe = regexp.MustCompile(`^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$`)

// parseFrom: `"Jane Doe" <jane@x.com>` → "Jane Doe"; a bare address stays as-is.
func parseFrom(raw string) string {
	if m := fromRe.FindStringSubmatch(raw); m != nil {
		if name := strings.TrimSpace(m[1]); name != "" {
			return name
		}
	}
	return strings.TrimSpace(raw)
}

func normalizeMessage(msg gmailMsg) EmailItem {
	date := ""
	if msg.InternalDate != "" {
		if ms, err := strconv.ParseInt(msg.InternalDate, 10, 64); err == nil {
			date = time.UnixMilli(ms).UTC().Format("2006-01-02T15:04:05.000Z")
		}
	}
	subject := header(msg, "Subject")
	if subject == "" {
		subject = "(no subject)"
	}
	return EmailItem{
		ID:      msg.ID,
		Subject: subject,
		From:    parseFrom(header(msg, "From")),
		Date:    date,
		Unread:  slices.Contains(msg.LabelIDs, "UNREAD"),
		// `#all/` opens the message regardless of which folder/label it lives
		// in; `#inbox/` 404s for queries that surface mail outside the inbox.
		URL: "https://mail.google.com/mail/u/0/#all/" + msg.ID,
	}
}

func fetchGmail(ctx context.Context, run jsonRunner, cfg gmailConfig) (GmailData, error) {
	var list struct {
		Messages []struct {
			ID string `json:"id"`
		} `json:"messages"`
	}
	if err := run(ctx, []string{
		"gmail", "users", "messages", "list",
		"--params", jsonArg(map[string]any{"userId": "me", "q": cfg.Query, "maxResults": cfg.Limit}),
	}, &list); err != nil {
		return GmailData{}, err
	}

	// list returns IDs only — fetch each message's headers concurrently.
	// `format=metadata` returns all headers; the `metadataHeaders` filter is
	// intentionally omitted (gws drops the headers entirely when it's passed).
	// One failure shouldn't sink the whole widget.
	msgs := make([]gmailMsg, len(list.Messages))
	errs := make([]error, len(list.Messages))
	var wg sync.WaitGroup
	for i, m := range list.Messages {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs[i] = run(ctx, []string{
				"gmail", "users", "messages", "get",
				"--params", jsonArg(map[string]any{"userId": "me", "id": m.ID, "format": "metadata"}),
			}, &msgs[i])
		}()
	}
	wg.Wait()

	emails := []EmailItem{}
	failedIDs := []string{}
	for i, m := range list.Messages {
		if errs[i] != nil {
			failedIDs = append(failedIDs, m.ID)
			continue
		}
		emails = append(emails, normalizeMessage(msgs[i]))
	}
	if len(failedIDs) > 0 {
		return GmailData{Emails: emails, Errors: failedIDs}, nil
	}
	return GmailData{Emails: emails}, nil
}
