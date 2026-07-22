package ccusage

import (
	"context"
	"errors"
	"testing"
	"time"

	"pulse/internal/cli"
)

func fake(stdout string, err error) *Module {
	return &Module{run: func(ctx context.Context, args []string) (string, error) {
		return stdout, err
	}}
}

func TestFetchParsesTotalsAndStampsToday(t *testing.T) {
	m := fake(`{"totals":{"totalCost":12.34}}`, nil)
	got, err := m.Fetch(context.Background(), SpendType, nil)
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	data := got.(SpendData)
	if data.CostUsd != 12.34 {
		t.Errorf("CostUsd = %v, want 12.34", data.CostUsd)
	}
	if want := time.Now().Format("2006-01-02"); data.Date != want {
		t.Errorf("Date = %q, want %q", data.Date, want)
	}
}

func TestFetchMissingTotalsIsZero(t *testing.T) {
	m := fake(`{}`, nil)
	got, err := m.Fetch(context.Background(), SpendType, nil)
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if got.(SpendData).CostUsd != 0 {
		t.Errorf("CostUsd = %v, want 0", got.(SpendData).CostUsd)
	}
}

func TestFetchNonJSONClassifiesFailed(t *testing.T) {
	m := fake("npx installed 12 packages\nnot json", nil)
	_, err := m.Fetch(context.Background(), SpendType, nil)
	var ce *cli.Error
	if !errors.As(err, &ce) || ce.Kind != cli.KindFailed {
		t.Fatalf("want cli.Error kind=failed, got %v", err)
	}
}

func TestFetchPassesThroughRunnerError(t *testing.T) {
	want := &cli.Error{Kind: cli.KindNotFound, Message: "ccusage not found — install it"}
	m := fake("", want)
	_, err := m.Fetch(context.Background(), SpendType, nil)
	if !errors.Is(err, want) {
		t.Fatalf("want runner error passthrough, got %v", err)
	}
}

func TestFetchQueriesTodayCompact(t *testing.T) {
	var gotArgs []string
	m := &Module{run: func(ctx context.Context, args []string) (string, error) {
		gotArgs = args
		return `{"totals":{"totalCost":0}}`, nil
	}}
	if _, err := m.Fetch(context.Background(), SpendType, nil); err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	compact := time.Now().Format("20060102")
	want := []string{"daily", "--json", "--since", compact, "--until", compact}
	if len(gotArgs) != len(want) {
		t.Fatalf("args = %v, want %v", gotArgs, want)
	}
	for i := range want {
		if gotArgs[i] != want[i] {
			t.Fatalf("args = %v, want %v", gotArgs, want)
		}
	}
}

func TestManifest(t *testing.T) {
	ms := New().Manifests()
	if len(ms) != 1 || ms[0].Type != SpendType {
		t.Fatalf("Manifests = %+v", ms)
	}
	m := ms[0]
	if !m.Refreshable || m.Integration != "ccusage" || m.Title != "Claude Usage" {
		t.Errorf("manifest fields wrong: %+v", m)
	}
	if len(m.ConfigFields) != 1 || m.ConfigFields[0].Key != "dailyLimitUsd" || m.ConfigFields[0].Default != 20.0 {
		t.Errorf("configFields wrong: %+v", m.ConfigFields)
	}
}
