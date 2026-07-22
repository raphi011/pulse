package github

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"pulse/internal/cli"
)

// fakeGh routes by argv prefix: "search prs …" → search fixture,
// "pr view …" → view fixture (or an error for a specific URL).
func fakeGh(t *testing.T, viewErrFor string) runner {
	t.Helper()
	search, err := os.ReadFile("testdata/search-prs.json")
	if err != nil {
		t.Fatal(err)
	}
	view, err := os.ReadFile("testdata/pr-view.json")
	if err != nil {
		t.Fatal(err)
	}
	return func(ctx context.Context, args []string) (string, error) {
		switch {
		case args[0] == "search":
			return string(search), nil
		case args[0] == "pr" && args[1] == "view":
			if viewErrFor != "" && args[2] == viewErrFor {
				return "", &cli.Error{Kind: cli.KindFailed, Message: "boom"}
			}
			return string(view), nil
		}
		t.Fatalf("unexpected gh args: %v", args)
		return "", nil
	}
}

func TestRollupCi(t *testing.T) {
	cases := []struct {
		name   string
		checks []ghCheck
		want   string
	}{
		{"no checks", nil, "none"},
		{"all pass", []ghCheck{{Conclusion: "SUCCESS"}}, "ok"},
		{"any fail wins", []ghCheck{{Conclusion: "SUCCESS"}, {Conclusion: "FAILURE"}}, "danger"},
		{"pending", []ghCheck{{Status: "IN_PROGRESS"}}, "warn"},
		{"empty signals count as pending", []ghCheck{{}}, "warn"},
		{"state used when no conclusion", []ghCheck{{State: "ERROR"}}, "danger"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := rollupCi(c.checks); got != c.want {
				t.Errorf("rollupCi = %q, want %q", got, c.want)
			}
		})
	}
}

func TestFetchPrsEnrichesAndSorts(t *testing.T) {
	got, err := fetchPrs(context.Background(), fakeGh(t, ""), prsConfig{Limit: 20})
	if err != nil {
		t.Fatalf("fetchPrs: %v", err)
	}
	if len(got.Prs) == 0 {
		t.Fatal("no PRs")
	}
	// Every PR is enriched from the view fixture (ci/review no longer "none"
	// when the fixture carries a rollup) and sorted newest-first.
	for i := 1; i < len(got.Prs); i++ {
		if got.Prs[i-1].UpdatedAt < got.Prs[i].UpdatedAt {
			t.Errorf("not sorted desc at %d", i)
		}
	}
	for _, pr := range got.Prs {
		if pr.Repo == "" || pr.URL == "" || pr.Author == "" {
			t.Errorf("unnormalized PR: %+v", pr)
		}
	}
}

func TestFetchPrsFailedEnrichKeepsBaseItem(t *testing.T) {
	// Find a URL from the search fixture to poison.
	base, err := fetchPrs(context.Background(), fakeGh(t, ""), prsConfig{Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	poison := base.Prs[0].URL
	got, err := fetchPrs(context.Background(), fakeGh(t, poison), prsConfig{Limit: 20})
	if err != nil {
		t.Fatalf("fetchPrs: %v", err)
	}
	for _, pr := range got.Prs {
		if pr.URL == poison && (pr.CI != "none" || pr.Review != "none") {
			t.Errorf("poisoned PR should keep base ci/review, got %+v", pr)
		}
	}
}

func TestFetchPrsAllAuthorsFailingSurfacesError(t *testing.T) {
	authErr := &cli.Error{Kind: cli.KindAuth, Message: "Not authenticated — run `gh auth login`"}
	run := func(ctx context.Context, args []string) (string, error) { return "", authErr }
	_, err := fetchPrs(context.Background(), run, prsConfig{Authors: []string{"a", "b"}, Limit: 5})
	if !errors.Is(err, authErr) {
		t.Fatalf("want auth error surfaced, got %v", err)
	}
}

func TestFetchPrsOneBadAuthorDoesNotSink(t *testing.T) {
	good := fakeGh(t, "")
	run := func(ctx context.Context, args []string) (string, error) {
		for _, a := range args {
			if a == "--author=bad" {
				return "", &cli.Error{Kind: cli.KindFailed, Message: "boom"}
			}
		}
		return good(ctx, args)
	}
	got, err := fetchPrs(context.Background(), run, prsConfig{Authors: []string{"good", "bad"}, Limit: 20})
	if err != nil {
		t.Fatalf("fetchPrs: %v", err)
	}
	if len(got.Prs) == 0 {
		t.Fatal("good author's PRs should survive")
	}
}

func TestFetchPrsDefaultsToMeAndCapsLimit(t *testing.T) {
	var sawAuthor string
	good := fakeGh(t, "")
	run := func(ctx context.Context, args []string) (string, error) {
		for _, a := range args {
			if strings.HasPrefix(a, "--author=") {
				sawAuthor = a
			}
		}
		return good(ctx, args)
	}
	got, err := fetchPrs(context.Background(), run, prsConfig{Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	if sawAuthor != "--author=@me" {
		t.Errorf("author = %q, want --author=@me", sawAuthor)
	}
	if len(got.Prs) > 1 {
		t.Errorf("limit not applied: %d PRs", len(got.Prs))
	}
}
