// Package github ports frontend/legacy-modules/github: PRs (with N+1
// CI/review enrichment), failing Actions runs, and Dependabot alerts via the
// gh CLI (process-model: stderr + non-zero exit, auth classified by regex).
package github

import (
	"context"
	"encoding/json"
	"regexp"

	"pulse/internal/cli"
)

var ghAuthPattern = regexp.MustCompile(`(?i)gh auth login|not logged in|authentication|HTTP 401|Bad credentials`)

// runner is the injectable gh seam: returns stdout.
type runner func(ctx context.Context, args []string) (string, error)

// RunGh runs gh with the shared auth classification. Exported because the
// githubstats module shares the gh CLI (and the "github" integration).
func RunGh(ctx context.Context, args []string) (string, error) {
	stdout, _, err := cli.Run(ctx, "gh", args, cli.Options{
		NotAuthPattern: ghAuthPattern,
		NotAuthMessage: "Not authenticated — run `gh auth login`",
	})
	return stdout, err
}

func ghJSON[T any](ctx context.Context, run runner, args []string) (T, error) {
	var out T
	stdout, err := run(ctx, args)
	if err != nil {
		return out, err
	}
	if err := json.Unmarshal([]byte(stdout), &out); err != nil {
		return out, &cli.Error{Kind: cli.KindFailed, Message: "gh returned unexpected output"}
	}
	return out, nil
}

func f64(v float64) *float64 { return &v }

func firstErr(errs []error) error {
	for _, err := range errs {
		if err != nil {
			return err
		}
	}
	return nil
}

// "owner/name" — interpolated into `gh api` paths, so reject anything with a
// path/query separator or whitespace (the Zod repoSchema's job, done
// fetch-side since the Go field DSL has no per-item pattern).
var repoRe = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)
