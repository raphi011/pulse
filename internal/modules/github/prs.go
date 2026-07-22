package github

import (
	"context"
	"sort"
	"strconv"
	"sync"
)

type ghCheck struct {
	Status     string `json:"status"`
	Conclusion string `json:"conclusion"`
	State      string `json:"state"`
}

type ghPrView struct {
	StatusCheckRollup []ghCheck `json:"statusCheckRollup"`
	ReviewDecision    string    `json:"reviewDecision"`
}

type ghSearchPr struct {
	Number     int    `json:"number"`
	Title      string `json:"title"`
	URL        string `json:"url"`
	Repository struct {
		NameWithOwner string `json:"nameWithOwner"`
	} `json:"repository"`
	Author struct {
		Login string `json:"login"`
	} `json:"author"`
	UpdatedAt string `json:"updatedAt"`
}

// PrItem mirrors the TS PrItem payload shape.
type PrItem struct {
	Repo      string `json:"repo"`
	Number    int    `json:"number"`
	Title     string `json:"title"`
	URL       string `json:"url"`
	Author    string `json:"author"`
	CI        string `json:"ci"`     // ok | warn | danger | none
	Review    string `json:"review"` // gh reviewDecision, or "none"
	UpdatedAt string `json:"updatedAt"`
}

type PrsData struct {
	Prs []PrItem `json:"prs"`
}

type prsConfig struct {
	Authors []string `json:"authors"`
	Limit   int      `json:"limit"`
}

var failSignals = map[string]bool{
	"FAILURE": true, "TIMED_OUT": true, "CANCELLED": true,
	"ERROR": true, "STARTUP_FAILURE": true, "ACTION_REQUIRED": true,
}
var pendingSignals = map[string]bool{
	"IN_PROGRESS": true, "QUEUED": true, "PENDING": true,
	"WAITING": true, "REQUESTED": true, "EXPECTED": true,
}

func rollupCi(checks []ghCheck) string {
	if len(checks) == 0 {
		return "none"
	}
	sawPending := false
	for _, c := range checks {
		signal := c.Conclusion
		if signal == "" {
			signal = c.State
		}
		if signal == "" {
			signal = c.Status
		}
		if failSignals[signal] {
			return "danger"
		}
		if pendingSignals[signal] || (c.Conclusion == "" && c.State == "") {
			sawPending = true
		}
	}
	if sawPending {
		return "warn"
	}
	return "ok"
}

func normalizeSearchPr(raw ghSearchPr) PrItem {
	return PrItem{
		Repo: raw.Repository.NameWithOwner, Number: raw.Number, Title: raw.Title,
		URL: raw.URL, Author: raw.Author.Login, CI: "none", Review: "none",
		UpdatedAt: raw.UpdatedAt,
	}
}

const searchJSONFields = "number,title,url,repository,author,updatedAt"

func enrichPr(ctx context.Context, run runner, pr PrItem) (PrItem, error) {
	view, err := ghJSON[ghPrView](ctx, run, []string{
		"pr", "view", pr.URL, "--json", "statusCheckRollup,reviewDecision",
	})
	if err != nil {
		return pr, err
	}
	pr.CI = rollupCi(view.StatusCheckRollup)
	if view.ReviewDecision != "" {
		pr.Review = view.ReviewDecision
	}
	return pr, nil
}

func searchAndEnrich(ctx context.Context, run runner, searchArgs []string) ([]PrItem, error) {
	raw, err := ghJSON[[]ghSearchPr](ctx, run, searchArgs)
	if err != nil {
		return nil, err
	}
	prs := make([]PrItem, len(raw))
	for i, r := range raw {
		prs[i] = normalizeSearchPr(r)
	}
	// N+1 enrichment, one goroutine per PR; a failed enrich keeps the base
	// item (allSettled semantics — one item's failure never sinks the widget).
	var wg sync.WaitGroup
	for i := range prs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if enriched, err := enrichPr(ctx, run, prs[i]); err == nil {
				prs[i] = enriched
			}
		}()
	}
	wg.Wait()
	return prs, nil
}

// fetchPrs: blank authors → your own open PRs. `gh search prs --author` is
// single-valued (last flag wins), so each author gets its own search; results
// merge, dedupe by URL, sort by recency, and cap to the limit.
func fetchPrs(ctx context.Context, run runner, cfg prsConfig) (PrsData, error) {
	authors := cfg.Authors
	if len(authors) == 0 {
		authors = []string{"@me"}
	}
	results := make([][]PrItem, len(authors))
	errs := make([]error, len(authors))
	var wg sync.WaitGroup
	for i, author := range authors {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i], errs[i] = searchAndEnrich(ctx, run, []string{
				"search", "prs", "--author=" + author, "--state=open",
				"--json", searchJSONFields, "--limit", strconv.Itoa(cfg.Limit),
			})
		}()
	}
	wg.Wait()

	// A single bad author shouldn't sink the widget, but a total failure
	// (e.g. auth) must surface rather than caching an empty "ok" result.
	merged := []PrItem{}
	failed := 0
	for i := range authors {
		if errs[i] != nil {
			failed++
			continue
		}
		merged = append(merged, results[i]...)
	}
	if failed == len(authors) {
		return PrsData{}, firstErr(errs)
	}

	seen := map[string]bool{}
	prs := []PrItem{}
	for _, pr := range merged {
		if !seen[pr.URL] {
			seen[pr.URL] = true
			prs = append(prs, pr)
		}
	}
	sort.SliceStable(prs, func(i, j int) bool { return prs[i].UpdatedAt > prs[j].UpdatedAt })
	if len(prs) > cfg.Limit {
		prs = prs[:cfg.Limit]
	}
	return PrsData{Prs: prs}, nil
}
