package github

import (
	"context"
	"errors"
	"testing"

	"pulse/internal/cli"
)

const runsFixture = `[
  {"displayTitle":"ci: fix build","workflowName":"CI","headBranch":"main",
   "event":"push","url":"https://github.com/o/r/actions/runs/1","createdAt":"2026-07-20T10:00:00Z"},
  {"displayTitle":"older run","workflowName":"CI","headBranch":"dev",
   "event":"pull_request","url":"https://github.com/o/r/actions/runs/2","createdAt":"2026-07-19T10:00:00Z"}
]`

func TestFetchFailingActionsEmptyReposShortCircuits(t *testing.T) {
	called := false
	run := func(ctx context.Context, args []string) (string, error) { called = true; return "[]", nil }
	got, err := fetchFailingActions(context.Background(), run, failingActionsConfig{Limit: 10})
	if err != nil || called {
		t.Fatalf("err=%v called=%v; want no CLI call", err, called)
	}
	if got.Runs == nil || len(got.Runs) != 0 {
		t.Fatalf("want empty non-nil runs, got %#v", got.Runs)
	}
}

func TestFetchFailingActionsMergesSortsAndNormalizes(t *testing.T) {
	run := func(ctx context.Context, args []string) (string, error) { return runsFixture, nil }
	got, err := fetchFailingActions(context.Background(), run,
		failingActionsConfig{Repos: []string{"o/r", "o/r2"}, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Runs) != 4 {
		t.Fatalf("want 4 runs, got %d", len(got.Runs))
	}
	for i := 1; i < len(got.Runs); i++ {
		if got.Runs[i-1].CreatedAt < got.Runs[i].CreatedAt {
			t.Errorf("not sorted desc at %d", i)
		}
	}
	if got.Runs[0].Name != "ci: fix build" || got.Runs[0].Branch != "main" {
		t.Errorf("normalize wrong: %+v", got.Runs[0])
	}
}

func TestFetchFailingActionsPartialFailureListsRepo(t *testing.T) {
	run := func(ctx context.Context, args []string) (string, error) {
		for i, a := range args {
			if a == "-R" && args[i+1] == "o/bad" {
				return "", &cli.Error{Kind: cli.KindFailed, Message: "boom"}
			}
		}
		return runsFixture, nil
	}
	got, err := fetchFailingActions(context.Background(), run,
		failingActionsConfig{Repos: []string{"o/r", "o/bad"}, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Errors) != 1 || got.Errors[0] != "o/bad" {
		t.Fatalf("Errors = %v, want [o/bad]", got.Errors)
	}
}

func TestFetchFailingActionsTotalFailureSurfaces(t *testing.T) {
	boom := &cli.Error{Kind: cli.KindAuth, Message: "no"}
	run := func(ctx context.Context, args []string) (string, error) { return "", boom }
	_, err := fetchFailingActions(context.Background(), run,
		failingActionsConfig{Repos: []string{"o/r"}, Limit: 10})
	if !errors.Is(err, boom) {
		t.Fatalf("want error surfaced, got %v", err)
	}
}

func TestFetchFailingActionsRejectsMalformedRepo(t *testing.T) {
	run := func(ctx context.Context, args []string) (string, error) { return runsFixture, nil }
	got, err := fetchFailingActions(context.Background(), run,
		failingActionsConfig{Repos: []string{"o/r", "not a repo"}, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Errors) != 1 || got.Errors[0] != "not a repo" {
		t.Fatalf("Errors = %v, want the malformed repo listed", got.Errors)
	}
}
