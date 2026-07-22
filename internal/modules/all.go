// Package modules aggregates every widget module for consumers that only
// need manifests: cmd/gen-widget-types and the registry parity tests. Fetch
// dependencies are nil/default here — do not use these instances to fetch.
package modules

import (
	"pulse/internal/module"
	"pulse/internal/modules/bookmarks"
	"pulse/internal/modules/ccusage"
	"pulse/internal/modules/github"
	"pulse/internal/modules/githubstats"
	"pulse/internal/modules/gws"
	"pulse/internal/modules/jira"
	"pulse/internal/modules/pomodoro"
	"pulse/internal/modules/system"
)

// ManifestModules returns one instance of every module, in registration
// order. All eight modules are ported (Plan 2 complete); append new modules
// here as they are added.
func ManifestModules() []module.Module {
	return []module.Module{
		system.New(),
		bookmarks.New(nil),
		ccusage.New(),
		github.New(),
		githubstats.New(),
		jira.New(),
		gws.New(),
		pomodoro.New(),
	}
}
