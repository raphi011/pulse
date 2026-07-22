// Package githubstats ports frontend/legacy-modules/github-stats:
// contribution summary + heatmap via the gh GraphQL API. It shares the gh
// runner (and the "github" integration) with internal/modules/github.
package githubstats

import (
	"context"
	"encoding/json"
	"time"

	"pulse/internal/cli"
)

// runner is the injectable gh seam (github.RunGh in production).
type runner func(ctx context.Context, args []string) (string, error)

type TrendPoint struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

type StatsData struct {
	Commits int          `json:"commits"`
	Prs     int          `json:"prs"`
	Reviews int          `json:"reviews"`
	Issues  int          `json:"issues"`
	Total   int          `json:"total"`
	Trend   []TrendPoint `json:"trend"`
}

type HeatmapDay struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
	Level int    `json:"level"` // 0..4
}
type HeatmapWeek struct {
	Days []HeatmapDay `json:"days"`
}
type HeatmapData struct {
	Total int           `json:"total"`
	Weeks []HeatmapWeek `json:"weeks"`
}

type rawContributionDay struct {
	Date              string `json:"date"`
	ContributionCount int    `json:"contributionCount"`
	ContributionLevel string `json:"contributionLevel"`
}
type rawWeek struct {
	ContributionDays []rawContributionDay `json:"contributionDays"`
}
type rawContributions struct {
	TotalCommitContributions            int `json:"totalCommitContributions"`
	TotalPullRequestContributions       int `json:"totalPullRequestContributions"`
	TotalPullRequestReviewContributions int `json:"totalPullRequestReviewContributions"`
	TotalIssueContributions             int `json:"totalIssueContributions"`
	ContributionCalendar                struct {
		TotalContributions int       `json:"totalContributions"`
		Weeks              []rawWeek `json:"weeks"`
	} `json:"contributionCalendar"`
}

// windowFor: `to` is always `now`; "year" means Jan 1 of now's UTC year.
func windowFor(timeframe string, now time.Time) (from, to string) {
	nowUTC := now.UTC()
	to = nowUTC.Format(time.RFC3339)
	if timeframe == "year" {
		return time.Date(nowUTC.Year(), 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339), to
	}
	days := map[string]int{"7d": 7, "30d": 30, "90d": 90}[timeframe]
	return nowUTC.AddDate(0, 0, -days).Format(time.RFC3339), to
}

// yearWindow: trailing 12 months (~53 weeks) for the classic heatmap.
func yearWindow(now time.Time) (from, to string) {
	nowUTC := now.UTC()
	return nowUTC.AddDate(-1, 0, 0).Format(time.RFC3339), nowUTC.Format(time.RFC3339)
}

const contribQuery = `query($from: DateTime!, $to: DateTime!) {
  viewer {
    contributionsCollection(from: $from, to: $to) {
      totalCommitContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
      totalIssueContributions
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays { date contributionCount contributionLevel }
        }
      }
    }
  }
}`

func toStatsData(raw rawContributions) StatsData {
	trend := []TrendPoint{}
	for _, w := range raw.ContributionCalendar.Weeks {
		for _, d := range w.ContributionDays {
			trend = append(trend, TrendPoint{Date: d.Date, Count: d.ContributionCount})
		}
	}
	return StatsData{
		Commits: raw.TotalCommitContributions,
		Prs:     raw.TotalPullRequestContributions,
		Reviews: raw.TotalPullRequestReviewContributions,
		Issues:  raw.TotalIssueContributions,
		Total:   raw.ContributionCalendar.TotalContributions,
		Trend:   trend,
	}
}

// quantile: nearest-rank value at fraction q (0..1) of an ascending-sorted
// slice.
func quantile(sorted []int, q float64) int {
	if len(sorted) == 0 {
		return 0
	}
	idx := int(q * float64(len(sorted)))
	if idx > len(sorted)-1 {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}

// toHeatmapData levels each day from its own count via quartiles of the
// active (positive-count) days rather than GitHub's contributionLevel —
// GitHub's levels are quartiles of the max, so one 385-count day collapses
// normal days into the faintest bucket. Rank-based quartiles are
// outlier-proof. Zero-count days are level 0.
func toHeatmapData(raw rawContributions) HeatmapData {
	positives := []int{}
	for _, w := range raw.ContributionCalendar.Weeks {
		for _, d := range w.ContributionDays {
			if d.ContributionCount > 0 {
				positives = append(positives, d.ContributionCount)
			}
		}
	}
	sortInts(positives)
	t1, t2, t3 := quantile(positives, 0.25), quantile(positives, 0.5), quantile(positives, 0.75)
	levelFor := func(count int) int {
		switch {
		case count <= 0:
			return 0
		case count <= t1:
			return 1
		case count <= t2:
			return 2
		case count <= t3:
			return 3
		default:
			return 4
		}
	}
	weeks := make([]HeatmapWeek, len(raw.ContributionCalendar.Weeks))
	for i, w := range raw.ContributionCalendar.Weeks {
		days := make([]HeatmapDay, len(w.ContributionDays))
		for j, d := range w.ContributionDays {
			days[j] = HeatmapDay{Date: d.Date, Count: d.ContributionCount, Level: levelFor(d.ContributionCount)}
		}
		weeks[i] = HeatmapWeek{Days: days}
	}
	return HeatmapData{Total: raw.ContributionCalendar.TotalContributions, Weeks: weeks}
}

func sortInts(s []int) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}

type graphqlResponse struct {
	Data *struct {
		Viewer *struct {
			ContributionsCollection *rawContributions `json:"contributionsCollection"`
		} `json:"viewer"`
	} `json:"data"`
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors"`
}

// fetchContributions runs the contributions query for a window; GraphQL
// `errors[]` (the HTTP-200 case) surface as failed.
func fetchContributions(ctx context.Context, run runner, from, to string) (rawContributions, error) {
	stdout, err := run(ctx, []string{
		"api", "graphql",
		"-f", "query=" + contribQuery,
		"-f", "from=" + from,
		"-f", "to=" + to,
	})
	if err != nil {
		return rawContributions{}, err
	}
	var body graphqlResponse
	if err := json.Unmarshal([]byte(stdout), &body); err != nil {
		return rawContributions{}, &cli.Error{Kind: cli.KindFailed, Message: "GitHub returned non-JSON output"}
	}
	if len(body.Errors) > 0 {
		return rawContributions{}, &cli.Error{Kind: cli.KindFailed, Message: body.Errors[0].Message}
	}
	if body.Data == nil || body.Data.Viewer == nil || body.Data.Viewer.ContributionsCollection == nil {
		return rawContributions{}, &cli.Error{Kind: cli.KindFailed, Message: "No contributions data in response"}
	}
	return *body.Data.Viewer.ContributionsCollection, nil
}
