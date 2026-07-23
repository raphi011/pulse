# Work Dashboard

Local, single-user, pluggable work dashboard. Wails v3 (Go backend) + Vite/React
webview. Personal project.

## Prerequisites

macOS. To build and run the app you need:

- **Go** ≥ 1.25 — the backend (`internal/`).
- **Wails v3 CLI** — `go install github.com/wailsapp/wails/v3/cmd/wails3@latest`
  (the repo pins `v3.0.0-alpha2.114` in `go.mod`).
- **Task** — `brew install go-task` (Wails drives the build through `Taskfile.yml`).
- **Node.js** 20+ and **npm** — the Vite + React frontend.
- **Xcode Command Line Tools** — `xcode-select --install`.

Then `cd frontend && npm install`.

Optional, only if you enable the matching module (each is a CLI the app shells
out to):

- [`gh`](https://cli.github.com) — GitHub / GitHub-stats modules (`gh auth login`).
- [`jira`](https://github.com/ankitpokhrel/jira-cli) — Jira module.
- `gws` — Google Workspace module.
- [`ccusage`](https://github.com/ryoppippi/ccusage) — Claude-spend module.

## Run

- `task start` — package the release `.app` and open it (one command to run the real app)

## Develop

- `wails3 dev` (or `task dev`) — dev mode with hot reload
- `go test -race ./internal/... ./cmd/...` — backend tests
- `cd frontend && npm test` — frontend tests
- `wails3 generate bindings -ts -i` — regenerate the (gitignored) TS bindings
  after changing any bound service

The app stores its data in `~/Library/Application Support/com.pulse.dashboard/`.
