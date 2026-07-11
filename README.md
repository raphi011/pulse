# Work Dashboard

Local, single-user, pluggable work dashboard.

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
