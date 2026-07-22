package githubstats

import (
	"context"
	"testing"
	"time"
)

func mustParse(t *testing.T, s string) time.Time {
	t.Helper()
	ts, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatal(err)
	}
	return ts
}

func TestWindowForPresets(t *testing.T) {
	now := mustParse(t, "2026-07-22T10:00:00Z")
	from, to := windowFor("7d", now)
	if to != "2026-07-22T10:00:00Z" || from != "2026-07-15T10:00:00Z" {
		t.Errorf("7d window = %s..%s", from, to)
	}
	from, _ = windowFor("year", now)
	if from != "2026-01-01T00:00:00Z" {
		t.Errorf("year from = %s, want Jan 1 UTC", from)
	}
	from, _ = windowFor("30d", now)
	if from != "2026-06-22T10:00:00Z" {
		t.Errorf("30d from = %s", from)
	}
}

func TestYearWindowTrailing12Months(t *testing.T) {
	now := mustParse(t, "2026-07-22T10:00:00Z")
	from, to := yearWindow(now)
	if from != "2025-07-22T10:00:00Z" || to != "2026-07-22T10:00:00Z" {
		t.Errorf("yearWindow = %s..%s", from, to)
	}
}

func sampleRaw() rawContributions {
	var raw rawContributions
	raw.TotalCommitContributions = 10
	raw.TotalPullRequestContributions = 3
	raw.TotalPullRequestReviewContributions = 2
	raw.TotalIssueContributions = 1
	raw.ContributionCalendar.TotalContributions = 16
	raw.ContributionCalendar.Weeks = []rawWeek{
		{ContributionDays: []rawContributionDay{
			{Date: "2026-07-20", ContributionCount: 0},
			{Date: "2026-07-21", ContributionCount: 1},
			{Date: "2026-07-22", ContributionCount: 2},
		}},
		{ContributionDays: []rawContributionDay{
			{Date: "2026-07-23", ContributionCount: 3},
			{Date: "2026-07-24", ContributionCount: 385},
		}},
	}
	return raw
}

func TestToStatsDataFlattensTrend(t *testing.T) {
	got := toStatsData(sampleRaw())
	if got.Commits != 10 || got.Prs != 3 || got.Reviews != 2 || got.Issues != 1 || got.Total != 16 {
		t.Errorf("totals wrong: %+v", got)
	}
	if len(got.Trend) != 5 || got.Trend[4].Count != 385 || got.Trend[0].Date != "2026-07-20" {
		t.Errorf("trend wrong: %+v", got.Trend)
	}
}

func TestToHeatmapDataRankBasedLevels(t *testing.T) {
	got := toHeatmapData(sampleRaw())
	if got.Total != 16 || len(got.Weeks) != 2 {
		t.Fatalf("shape wrong: %+v", got)
	}
	days := append(got.Weeks[0].Days, got.Weeks[1].Days...)
	// positives sorted: [1 2 3 385]; quartile thresholds t1=2, t2=3, t3=385.
	wantLevels := []int{0, 1, 1, 2, 3}
	for i, d := range days {
		if d.Level != wantLevels[i] {
			t.Errorf("day %s level = %d, want %d", d.Date, d.Level, wantLevels[i])
		}
	}
}

func TestFetchContributionsSurfacesGraphQLErrors(t *testing.T) {
	run := func(ctx context.Context, args []string) (string, error) {
		return `{"errors":[{"message":"rate limited"}]}`, nil
	}
	if _, err := fetchContributions(context.Background(), run, "a", "b"); err == nil {
		t.Fatal("want error from GraphQL errors[]")
	}
}

func TestFetchContributionsParsesViewer(t *testing.T) {
	run := func(ctx context.Context, args []string) (string, error) {
		return `{"data":{"viewer":{"contributionsCollection":{
			"totalCommitContributions":5,
			"contributionCalendar":{"totalContributions":5,"weeks":[]}}}}}`, nil
	}
	got, err := fetchContributions(context.Background(), run, "a", "b")
	if err != nil {
		t.Fatal(err)
	}
	if got.TotalCommitContributions != 5 {
		t.Errorf("parse wrong: %+v", got)
	}
}
