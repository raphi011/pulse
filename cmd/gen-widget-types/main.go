// Command gen-widget-types writes the canonical widget-type list the frontend
// parity test checks against. Re-run after adding a module:
//
//	go run ./cmd/gen-widget-types
package main

import (
	"encoding/json"
	"log"
	"os"
	"sort"

	"pulse/internal/module"
	"pulse/internal/modules/bookmarks"
	"pulse/internal/modules/system"
)

func main() {
	reg, err := module.NewRegistry(system.New(), bookmarks.New(nil))
	if err != nil {
		log.Fatal(err)
	}
	types := []string{}
	for _, m := range reg.Manifests() {
		types = append(types, m.Type)
	}
	sort.Strings(types)
	out, _ := json.MarshalIndent(types, "", "  ")
	if err := os.WriteFile("frontend/src/widget-types.gen.json", append(out, '\n'), 0o644); err != nil {
		log.Fatal(err)
	}
}
