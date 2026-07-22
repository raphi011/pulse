package github

import (
	"context"
	"testing"
)

const alertsFixture = `[
  {"html_url":"https://github.com/o/r/security/dependabot/1",
   "security_advisory":{"summary":"Low issue","severity":"low"},
   "security_vulnerability":{"package":{"name":"leftpad","ecosystem":"npm"}}},
  {"html_url":"https://github.com/o/r/security/dependabot/2",
   "security_advisory":{"summary":"Critical issue","severity":"critical"},
   "security_vulnerability":{"package":{"name":"lodash","ecosystem":"npm"}}}
]`

func TestFetchDependabotFiltersAndSortsBySeverity(t *testing.T) {
	run := func(ctx context.Context, args []string) (string, error) { return alertsFixture, nil }

	all, err := fetchDependabot(context.Background(), run,
		dependabotConfig{Repos: []string{"o/r"}, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(all.Alerts) != 2 || all.Alerts[0].Severity != "critical" {
		t.Fatalf("want 2 alerts sorted critical-first, got %+v", all.Alerts)
	}

	// REST severity filter is exact-match upstream, so the floor is client-side.
	high, err := fetchDependabot(context.Background(), run,
		dependabotConfig{Repos: []string{"o/r"}, Severity: "high", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(high.Alerts) != 1 || high.Alerts[0].Package != "lodash" {
		t.Fatalf("severity floor wrong: %+v", high.Alerts)
	}
}

func TestFetchDependabotEmptyReposShortCircuits(t *testing.T) {
	run := func(ctx context.Context, args []string) (string, error) {
		t.Fatal("should not call gh")
		return "", nil
	}
	got, err := fetchDependabot(context.Background(), run, dependabotConfig{Limit: 10})
	if err != nil || got.Alerts == nil || len(got.Alerts) != 0 {
		t.Fatalf("want empty non-nil alerts, got %#v err=%v", got.Alerts, err)
	}
}
