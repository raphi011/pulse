# Work Dashboard

Local, single-user, pluggable work dashboard.

## Prerequisites

macOS. To build and run the app you need:

- **Node.js** 18+ (20 LTS recommended; developed on 24) and **npm** — the Vite + React frontend.
- **Rust** (stable, ≥ 1.77.2) via [rustup](https://rustup.rs) — the Tauri backend. `cargo` must be on your `PATH`.
- **Xcode Command Line Tools** — provides the C compiler/linker Tauri links against. Install with `xcode-select --install`.

Then `npm install` to pull the JS dependencies (Rust crates are fetched on first build).

Optional, only if you enable the matching module (each is a CLI the app shells out to):

- [`gh`](https://cli.github.com) — GitHub module (must be authenticated: `gh auth login`).
- [`jira`](https://github.com/ankitpokhrel/jira-cli) — Jira module.
- `gws` — Google Workspace module.

## Run
- `npm start` — build the release `.app` and open it (one command to run the real app)

## Develop
- `npm run dev` — start dev server (`tauri dev`: Rust + webview)
- `npm test` — run tests
- `npm run db:generate` — schema migration files (applied in-app on launch, no separate migrate step)

## Build
- `npm run build` (`tauri build`) produces a release `.app` (and `.dmg`) under
  `src-tauri/target/release/bundle/`. First release compile can take a while.
- These are unsigned local builds: a `.app` you build yourself opens straight from
  Finder (no quarantine). Only a `.app` you *downloaded* would need
  `xattr -cr <path-to-app>` to clear the quarantine flag before it'll open.

## Add a module
1. Create `src/modules/<name>/manifest.ts` (export `<name>Manifest` via `defineManifest({ type, title, configSchema, defaultConfig, refreshable?, integration? })`).
2. `fetch.ts` — call `registerFetch(manifest, { fetch })`.
3. `widgets/*.tsx` + `render.ts` — call `registerRender(manifest, { Component, icon?, count?, HeaderControls?, formEditable? })`.
4. Add `import "./<name>/fetch"` to `src/modules/fetch.ts` and `import "./<name>/render"` to `src/modules/render.ts`.

Storage lives in `dashboard.db` (SQLite). Layout is the `widgets` table; cached fetch results live in `widget_cache`.
