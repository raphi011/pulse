package jira

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"pulse/internal/cli"
)

// Issue mirrors the TS JiraIssue payload shape.
type Issue struct {
	Key      string  `json:"key"`
	Summary  string  `json:"summary"`
	Status   string  `json:"status"`
	Assignee *string `json:"assignee"` // null when unassigned
	URL      string  `json:"url"`      // <server>/browse/<KEY>
}

type JqlData struct {
	Issues []Issue `json:"issues"`
}

type jqlConfig struct {
	Jql   string `json:"jql"`
	Limit int    `json:"limit"`
}

type rawIssue struct {
	Key    string `json:"key"`
	Fields struct {
		Summary string `json:"summary"`
		Status  *struct {
			Name string `json:"name"`
		} `json:"status"`
		Assignee *struct {
			DisplayName string `json:"displayName"`
		} `json:"assignee"`
	} `json:"fields"`
}

var orderByRe = regexp.MustCompile(`(?is)\s+order\s+by\s+.+$`)

// stripTrailingOrderBy strips a trailing ORDER BY clause — jira-cli appends
// its own, so a trailing one in the user's JQL is a syntax error. Quoted
// string literals are blanked to a non-whitespace NUL sentinel (preserving
// rune indices, and non-whitespace so the clause's leading \s+ can't span a
// blanked literal) before locating the clause; the original is cut at the
// found index.
func stripTrailingOrderBy(jql string) string {
	runes := []rune(jql)
	masked := make([]rune, 0, len(runes))
	var quote rune
	for i := 0; i < len(runes); i++ {
		ch := runes[i]
		switch {
		case quote != 0:
			if ch == '\\' && i+1 < len(runes) {
				masked = append(masked, 0, 0) // blank the backslash and the escaped char
				i++
				continue
			}
			masked = append(masked, 0)
			if ch == quote {
				quote = 0
			}
		case ch == '"' || ch == '\'':
			masked = append(masked, 0)
			quote = ch
		default:
			masked = append(masked, ch)
		}
	}
	maskedStr := string(masked)
	loc := orderByRe.FindStringIndex(maskedStr)
	if loc == nil {
		return strings.TrimSpace(jql)
	}
	runeIdx := utf8.RuneCountInString(maskedStr[:loc[0]])
	return strings.TrimSpace(string(runes[:runeIdx]))
}

func normalizeIssue(raw rawIssue, serverURL string) Issue {
	issue := Issue{
		Key: raw.Key, Summary: raw.Fields.Summary, Status: "Unknown",
		URL: serverURL + "/browse/" + raw.Key,
	}
	if raw.Fields.Status != nil && raw.Fields.Status.Name != "" {
		issue.Status = raw.Fields.Status.Name
	}
	if raw.Fields.Assignee != nil {
		if name := strings.TrimSpace(raw.Fields.Assignee.DisplayName); name != "" {
			issue.Assignee = &name
		}
	}
	return issue
}

var noResultRe = regexp.MustCompile(`(?i)no result found`)

func (m *Module) fetchJql(ctx context.Context, cfg jqlConfig) (JqlData, error) {
	jql := stripTrailingOrderBy(cfg.Jql)
	raw, err := jiraJSON[[]rawIssue](ctx, m.run, []string{
		"issue", "list", "-q", jql, "--order-by", "updated", "--paginate", fmt.Sprintf("0:%d", cfg.Limit),
	})
	if err != nil {
		// jira-cli exits non-zero with this message when a query matches nothing.
		var ce *cli.Error
		if errors.As(err, &ce) && noResultRe.MatchString(ce.Message) {
			return JqlData{Issues: []Issue{}}, nil
		}
		return JqlData{}, err
	}
	server, err := m.serverURL()
	if err != nil {
		return JqlData{}, err
	}
	issues := make([]Issue, 0, len(raw))
	for _, r := range raw {
		issues = append(issues, normalizeIssue(r, server))
	}
	return JqlData{Issues: issues}, nil
}
