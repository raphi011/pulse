package module_test

import (
	"encoding/json"
	"os"
	"sort"
	"testing"

	"pulse/internal/module"
	"pulse/internal/modules"
)

// TestWidgetTypeParityWithFrontend guards against the Go registry and the
// committed frontend/src/widget-types.gen.json drifting apart. Both sides
// (this test and the frontend registry-parity test) must agree on the same
// set of widget types.
func TestWidgetTypeParityWithFrontend(t *testing.T) {
	reg, err := module.NewRegistry(modules.ManifestModules()...)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}

	got := map[string]bool{}
	for _, m := range reg.Manifests() {
		got[m.Type] = true
	}

	raw, err := os.ReadFile("../../frontend/src/widget-types.gen.json")
	if err != nil {
		t.Fatalf("reading frontend/src/widget-types.gen.json: %v", err)
	}
	var want []string
	if err := json.Unmarshal(raw, &want); err != nil {
		t.Fatalf("unmarshal widget-types.gen.json: %v", err)
	}

	wantSet := map[string]bool{}
	for _, ty := range want {
		wantSet[ty] = true
	}

	var missingFromJSON, missingFromGo []string
	for ty := range got {
		if !wantSet[ty] {
			missingFromJSON = append(missingFromJSON, ty)
		}
	}
	for ty := range wantSet {
		if !got[ty] {
			missingFromGo = append(missingFromGo, ty)
		}
	}
	sort.Strings(missingFromJSON)
	sort.Strings(missingFromGo)

	if len(missingFromJSON) > 0 || len(missingFromGo) > 0 {
		t.Fatalf(
			"widget-types.gen.json is out of date (in Go registry but not JSON: %v; in JSON but not Go registry: %v) — run `go run ./cmd/gen-widget-types` and commit the result",
			missingFromJSON, missingFromGo,
		)
	}
}
