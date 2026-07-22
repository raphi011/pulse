package github

import (
	"context"
	"sort"
	"strconv"
	"sync"

	"pulse/internal/cli"
)

type ghRun struct {
	DisplayTitle string `json:"displayTitle"`
	WorkflowName string `json:"workflowName"`
	HeadBranch   string `json:"headBranch"`
	Event        string `json:"event"`
	URL          string `json:"url"`
	CreatedAt    string `json:"createdAt"`
}

// RunItem mirrors the TS RunItem payload shape.
type RunItem struct {
	Repo      string `json:"repo"`
	Name      string `json:"name"`
	URL       string `json:"url"`
	Branch    string `json:"branch"`
	Event     string `json:"event"`
	CreatedAt string `json:"createdAt"`
}

type FailingActionsData struct {
	Runs   []RunItem `json:"runs"`
	Errors []string  `json:"errors,omitempty"`
}

type failingActionsConfig struct {
	Repos []string `json:"repos"`
	Limit int      `json:"limit"`
}

const runJSONFields = "displayTitle,workflowName,headBranch,event,url,createdAt"

func fetchFailingActions(ctx context.Context, run runner, cfg failingActionsConfig) (FailingActionsData, error) {
	if len(cfg.Repos) == 0 {
		return FailingActionsData{Runs: []RunItem{}}, nil
	}
	results := make([][]RunItem, len(cfg.Repos))
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
			raw, err := ghJSON[[]ghRun](ctx, run, []string{
				"run", "list", "-R", repo, "--status=failure",
				"--json", runJSONFields, "--limit", strconv.Itoa(cfg.Limit),
			})
			if err != nil {
				errs[i] = err
				return
			}
			items := make([]RunItem, len(raw))
			for j, r := range raw {
				items[j] = RunItem{
					Repo: repo, Name: r.DisplayTitle, URL: r.URL,
					Branch: r.HeadBranch, Event: r.Event, CreatedAt: r.CreatedAt,
				}
			}
			results[i] = items
		}()
	}
	wg.Wait()

	failedRepos := []string{}
	runs := []RunItem{}
	for i, repo := range cfg.Repos {
		if errs[i] != nil {
			failedRepos = append(failedRepos, repo)
			continue
		}
		runs = append(runs, results[i]...)
	}
	if len(failedRepos) == len(cfg.Repos) {
		return FailingActionsData{}, firstErr(errs)
	}
	// Newest-first across repos before the widget slices, so an older run from
	// the first repo can't permanently mask a fresher failure from a later one.
	sort.SliceStable(runs, func(i, j int) bool { return runs[i].CreatedAt > runs[j].CreatedAt })
	if len(failedRepos) > 0 {
		return FailingActionsData{Runs: runs, Errors: failedRepos}, nil
	}
	return FailingActionsData{Runs: runs}, nil
}
