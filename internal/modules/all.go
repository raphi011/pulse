// Package modules aggregates every widget module for consumers that only
// need manifests: cmd/gen-widget-types and the registry parity tests. Fetch
// dependencies are nil/default here — do not use these instances to fetch.
package modules

import (
	"pulse/internal/module"
	"pulse/internal/modules/bookmarks"
	"pulse/internal/modules/system"
)

// ManifestModules returns one instance of every module, in registration
// order. Append new modules here as they are ported (Plan 2).
func ManifestModules() []module.Module {
	return []module.Module{
		system.New(),
		bookmarks.New(nil),
	}
}
