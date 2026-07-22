package github

import (
	"context"
	"testing"
)

func TestManifestsListThreeTypes(t *testing.T) {
	ms := New().Manifests()
	want := map[string]bool{PrsType: true, FailingActionsType: true, DependabotType: true}
	if len(ms) != 3 {
		t.Fatalf("want 3 manifests, got %d", len(ms))
	}
	for _, m := range ms {
		if !want[m.Type] {
			t.Errorf("unexpected type %q", m.Type)
		}
		if !m.Refreshable || m.Integration != "github" {
			t.Errorf("%s: refreshable/integration wrong: %+v", m.Type, m)
		}
	}
}

func TestFetchDispatchesUnknownType(t *testing.T) {
	if _, err := New().Fetch(context.Background(), "github.nope", nil); err == nil {
		t.Fatal("want error for unknown type")
	}
}

func TestFetchDecodesConfig(t *testing.T) {
	m := &Module{run: func(ctx context.Context, args []string) (string, error) { return "[]", nil }}
	got, err := m.Fetch(context.Background(), FailingActionsType,
		map[string]any{"repos": []any{}, "limit": 10.0})
	if err != nil {
		t.Fatal(err)
	}
	if got.(FailingActionsData).Runs == nil {
		t.Fatal("runs must be non-nil")
	}
}
