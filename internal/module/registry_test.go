package module

import (
	"context"
	"errors"
	"testing"
)

type fakeModule struct {
	manifests []Manifest
	fetch     func(ctx context.Context, widgetType string, config map[string]any) (any, error)
	options   map[string]OptionsProvider
}

func (m fakeModule) Manifests() []Manifest { return m.manifests }
func (m fakeModule) Fetch(ctx context.Context, wt string, c map[string]any) (any, error) {
	return m.fetch(ctx, wt, c)
}
func (m fakeModule) FieldOptions() map[string]OptionsProvider { return m.options }

func TestNewRegistryDuplicateWidgetType(t *testing.T) {
	a := fakeModule{manifests: []Manifest{{Type: "sysstats"}}}
	b := fakeModule{manifests: []Manifest{{Type: "sysstats"}}}

	_, err := NewRegistry(a, b)
	if err == nil {
		t.Fatal("expected error for duplicate widget type")
	}
}

func TestNewRegistryDuplicateOptionsKey(t *testing.T) {
	a := fakeModule{
		manifests: []Manifest{{Type: "a"}},
		options:   map[string]OptionsProvider{"boards": func(ctx context.Context) ([]FieldOption, error) { return nil, nil }},
	}
	b := fakeModule{
		manifests: []Manifest{{Type: "b"}},
		options:   map[string]OptionsProvider{"boards": func(ctx context.Context) ([]FieldOption, error) { return nil, nil }},
	}

	_, err := NewRegistry(a, b)
	if err == nil {
		t.Fatal("expected error for duplicate options key")
	}
}

func TestRegistryManifestFoundNotFound(t *testing.T) {
	a := fakeModule{manifests: []Manifest{{Type: "sysstats", Title: "System Stats"}}}
	reg, err := NewRegistry(a)
	if err != nil {
		t.Fatal(err)
	}

	got, ok := reg.Manifest("sysstats")
	if !ok || got.Title != "System Stats" {
		t.Fatalf("got %v, %v", got, ok)
	}

	_, ok = reg.Manifest("nope")
	if ok {
		t.Fatal("expected not found")
	}
}

func TestRegistryManifestsPreservesRegistrationOrder(t *testing.T) {
	a := fakeModule{manifests: []Manifest{{Type: "b"}, {Type: "a"}}}
	c := fakeModule{manifests: []Manifest{{Type: "z"}}}
	reg, err := NewRegistry(a, c)
	if err != nil {
		t.Fatal(err)
	}

	got := reg.Manifests()
	if len(got) != 3 || got[0].Type != "b" || got[1].Type != "a" || got[2].Type != "z" {
		t.Fatalf("got %v", got)
	}
}

func TestRegistryFetchDispatchesToOwningModule(t *testing.T) {
	called := false
	a := fakeModule{
		manifests: []Manifest{{Type: "sysstats"}},
		fetch: func(ctx context.Context, wt string, c map[string]any) (any, error) {
			called = true
			if wt != "sysstats" {
				t.Fatalf("unexpected widget type %q", wt)
			}
			return "ok", nil
		},
	}
	b := fakeModule{
		manifests: []Manifest{{Type: "other"}},
		fetch: func(ctx context.Context, wt string, c map[string]any) (any, error) {
			t.Fatal("should not be called")
			return nil, nil
		},
	}
	reg, err := NewRegistry(a, b)
	if err != nil {
		t.Fatal(err)
	}

	got, err := reg.Fetch(context.Background(), "sysstats", nil)
	if err != nil {
		t.Fatal(err)
	}
	if got != "ok" || !called {
		t.Fatalf("got %v, called=%v", got, called)
	}
}

func TestRegistryFetchUnknownType(t *testing.T) {
	a := fakeModule{manifests: []Manifest{{Type: "sysstats"}}}
	reg, err := NewRegistry(a)
	if err != nil {
		t.Fatal(err)
	}

	_, err = reg.Fetch(context.Background(), "nope", nil)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestRegistryFieldOptionsKnownKeyDelegates(t *testing.T) {
	a := fakeModule{
		manifests: []Manifest{{Type: "jira"}},
		options: map[string]OptionsProvider{
			"boards": func(ctx context.Context) ([]FieldOption, error) {
				return []FieldOption{{Value: "b1", Label: "Board 1"}}, nil
			},
		},
	}
	reg, err := NewRegistry(a)
	if err != nil {
		t.Fatal(err)
	}

	got, err := reg.FieldOptions(context.Background(), "boards")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Value != "b1" || got[0].Label != "Board 1" {
		t.Fatalf("got %v", got)
	}
}

func TestRegistryFieldOptionsUnknownKeyEmpty(t *testing.T) {
	a := fakeModule{manifests: []Manifest{{Type: "jira"}}}
	reg, err := NewRegistry(a)
	if err != nil {
		t.Fatal(err)
	}

	got, err := reg.FieldOptions(context.Background(), "nope")
	if err != nil {
		t.Fatal(err)
	}
	if got == nil {
		t.Fatal("expected non-nil empty slice")
	}
	if len(got) != 0 {
		t.Fatalf("got %v", got)
	}
}

func TestRegistryFieldOptionsProviderError(t *testing.T) {
	wantErr := errors.New("boom")
	a := fakeModule{
		manifests: []Manifest{{Type: "jira"}},
		options: map[string]OptionsProvider{
			"boards": func(ctx context.Context) ([]FieldOption, error) { return nil, wantErr },
		},
	}
	reg, err := NewRegistry(a)
	if err != nil {
		t.Fatal(err)
	}

	_, err = reg.FieldOptions(context.Background(), "boards")
	if !errors.Is(err, wantErr) {
		t.Fatalf("got %v", err)
	}
}
