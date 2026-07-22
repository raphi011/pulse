package jira

import (
	"context"
	"errors"
	"os"
	"testing"

	"pulse/internal/cli"
)

func TestStripTrailingOrderBy(t *testing.T) {
	cases := []struct{ name, in, want string }{
		{"plain", "project = X ORDER BY updated DESC", "project = X"},
		{"case-insensitive multiline", "project = X\norder by\ncreated", "project = X"},
		{"no clause untouched", "assignee = currentUser()", "assignee = currentUser()"},
		{"quoted literal survives", `summary ~ "sort order by date"`, `summary ~ "sort order by date"`},
		{"quoted then real clause", `summary ~ "order by x" ORDER BY updated`, `summary ~ "order by x"`},
		{"escaped quote in literal", `summary ~ "a \" order by b" ORDER BY updated`, `summary ~ "a \" order by b"`},
		{"single quotes", `summary ~ 'order by x' ORDER BY updated`, `summary ~ 'order by x'`},
		{"non-ascii before clause", `summary ~ "über" ORDER BY updated`, `summary ~ "über"`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := stripTrailingOrderBy(c.in); got != c.want {
				t.Errorf("got %q, want %q", got, c.want)
			}
		})
	}
}

func testModule(t *testing.T, stdout string, runErr error) *Module {
	t.Helper()
	return &Module{
		run:        func(ctx context.Context, args []string) (string, error) { return stdout, runErr },
		readConfig: func() ([]byte, error) { return []byte("server: https://x.atlassian.net/\n"), nil },
	}
}

func TestFetchJqlNormalizesIssues(t *testing.T) {
	fixture, err := os.ReadFile("testdata/jql.json")
	if err != nil {
		t.Fatal(err)
	}
	m := testModule(t, string(fixture), nil)
	got, err := m.fetchJql(context.Background(), jqlConfig{Jql: "project = X", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Issues) == 0 {
		t.Fatal("no issues parsed")
	}
	first := got.Issues[0]
	if first.Key == "" || first.URL != "https://x.atlassian.net/browse/"+first.Key {
		t.Errorf("normalize wrong: %+v", first)
	}
}

func TestFetchJqlNoResultFoundIsEmpty(t *testing.T) {
	m := testModule(t, "", &cli.Error{Kind: cli.KindFailed, Message: "✗ No result found for given query"})
	got, err := m.fetchJql(context.Background(), jqlConfig{Jql: "project = X", Limit: 10})
	if err != nil {
		t.Fatalf("want empty result, got err %v", err)
	}
	if got.Issues == nil || len(got.Issues) != 0 {
		t.Fatalf("want empty non-nil issues, got %#v", got.Issues)
	}
}

func TestFetchJqlAppendsRawAndPagination(t *testing.T) {
	var gotArgs []string
	m := &Module{
		run: func(ctx context.Context, args []string) (string, error) {
			gotArgs = args
			return "[]", nil
		},
		readConfig: func() ([]byte, error) { return []byte("server: https://x.atlassian.net"), nil },
	}
	if _, err := m.fetchJql(context.Background(), jqlConfig{Jql: "project = X", Limit: 25}); err != nil {
		t.Fatal(err)
	}
	want := []string{"issue", "list", "-q", "project = X", "--order-by", "updated", "--paginate", "0:25", "--raw"}
	if len(gotArgs) != len(want) {
		t.Fatalf("args = %v", gotArgs)
	}
	for i := range want {
		if gotArgs[i] != want[i] {
			t.Fatalf("args = %v, want %v", gotArgs, want)
		}
	}
}

func TestNormalizeIssueNullAssignee(t *testing.T) {
	fixture, err := os.ReadFile("testdata/jql.json")
	if err != nil {
		t.Fatal(err)
	}
	m := testModule(t, string(fixture), nil)
	got, err := m.fetchJql(context.Background(), jqlConfig{Jql: "project = X", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Issues) < 3 {
		t.Fatalf("want at least 3 issues, got %d", len(got.Issues))
	}
	// CORE-102: empty-string displayName should normalize to nil
	if got.Issues[1].Key != "CORE-102" {
		t.Fatalf("fixture[1] should be CORE-102, got %s", got.Issues[1].Key)
	}
	if got.Issues[1].Assignee != nil {
		t.Errorf("CORE-102 (empty displayName) assignee should be nil, got %v", got.Issues[1].Assignee)
	}
	// CORE-103: null assignee should normalize to nil
	if got.Issues[2].Key != "CORE-103" {
		t.Fatalf("fixture[2] should be CORE-103, got %s", got.Issues[2].Key)
	}
	if got.Issues[2].Assignee != nil {
		t.Errorf("CORE-103 (null assignee) assignee should be nil, got %v", got.Issues[2].Assignee)
	}
}

func TestFetchJqlPassthroughNonNotFoundErrors(t *testing.T) {
	m := testModule(t, "", &cli.Error{Kind: cli.KindAuth, Message: "Not authenticated — run `jira init`"})
	_, err := m.fetchJql(context.Background(), jqlConfig{Jql: "project = X", Limit: 10})
	if err == nil {
		t.Fatal("want error passthrough for auth error, got nil")
	}
	var ce *cli.Error
	if !errors.As(err, &ce) {
		t.Fatalf("want *cli.Error, got %T", err)
	}
	if ce.Kind != cli.KindAuth {
		t.Errorf("want KindAuth, got %v", ce.Kind)
	}
}
