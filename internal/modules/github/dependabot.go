package github

import (
	"context"
	"fmt"
	"sort"
	"sync"

	"pulse/internal/cli"
)

type ghAlert struct {
	HTMLURL          string `json:"html_url"`
	SecurityAdvisory struct {
		Summary  string `json:"summary"`
		Severity string `json:"severity"`
	} `json:"security_advisory"`
	SecurityVulnerability struct {
		Package struct {
			Name string `json:"name"`
		} `json:"package"`
	} `json:"security_vulnerability"`
}

// AlertItem mirrors the TS AlertItem payload shape.
type AlertItem struct {
	Repo     string `json:"repo"`
	Package  string `json:"package"`
	Severity string `json:"severity"`
	Summary  string `json:"summary"`
	URL      string `json:"url"`
}

type DependabotData struct {
	Alerts []AlertItem `json:"alerts"`
	Errors []string    `json:"errors,omitempty"`
}

type dependabotConfig struct {
	Repos    []string `json:"repos"`
	Severity string   `json:"severity"`
	Limit    int      `json:"limit"`
}

// Ascending severity — index doubles as a rank for floor-filtering and sorting.
var severityOrder = []string{"low", "medium", "high", "critical"}

func severityRank(s string) int {
	for i, o := range severityOrder {
		if o == s {
			return i
		}
	}
	return -1
}

func fetchDependabot(ctx context.Context, run runner, cfg dependabotConfig) (DependabotData, error) {
	if len(cfg.Repos) == 0 {
		return DependabotData{Alerts: []AlertItem{}}, nil
	}
	results := make([][]AlertItem, len(cfg.Repos))
	errs := make([]error, len(cfg.Repos))
	var wg sync.WaitGroup
	for i, repo := range cfg.Repos {
		if !repoRe.MatchString(repo) {
			errs[i] = &cli.Error{Kind: cli.KindFailed, Message: "invalid repo: " + repo}
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			raw, err := ghJSON[[]ghAlert](ctx, run, []string{
				"api", fmt.Sprintf("/repos/%s/dependabot/alerts?state=open&per_page=50", repo),
			})
			if err != nil {
				errs[i] = err
				return
			}
			items := make([]AlertItem, len(raw))
			for j, a := range raw {
				items[j] = AlertItem{
					Repo: repo, Package: a.SecurityVulnerability.Package.Name,
					Severity: a.SecurityAdvisory.Severity, Summary: a.SecurityAdvisory.Summary,
					URL: a.HTMLURL,
				}
			}
			results[i] = items
		}()
	}
	wg.Wait()

	failedRepos := []string{}
	merged := []AlertItem{}
	for i, repo := range cfg.Repos {
		if errs[i] != nil {
			failedRepos = append(failedRepos, repo)
			continue
		}
		merged = append(merged, results[i]...)
	}
	if len(failedRepos) == len(cfg.Repos) {
		return DependabotData{}, firstErr(errs)
	}
	// REST `severity` is exact-match, not a floor (picking "high" would drop
	// "critical"), so treat it as a minimum client-side. Sort most-severe
	// first before the widget slices.
	min := 0
	if cfg.Severity != "" {
		min = severityRank(cfg.Severity)
	}
	alerts := []AlertItem{}
	for _, a := range merged {
		if severityRank(a.Severity) >= min {
			alerts = append(alerts, a)
		}
	}
	sort.SliceStable(alerts, func(i, j int) bool {
		return severityRank(alerts[i].Severity) > severityRank(alerts[j].Severity)
	})
	if len(failedRepos) > 0 {
		return DependabotData{Alerts: alerts, Errors: failedRepos}, nil
	}
	return DependabotData{Alerts: alerts}, nil
}
