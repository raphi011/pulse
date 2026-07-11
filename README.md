# Work Dashboard

Local, single-user, pluggable work dashboard.

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
1. Create `src/modules/<name>/manifest.ts` (types, Zod config, defaults).
2. `server.ts` — call `registerServerWidget({ type, configSchema, defaultConfig, fetch })`.
3. `widgets/*.tsx` + `client.ts` — call `registerClientWidget({ type, title, Component })`.
4. Add `import "./<name>/server"` to `src/modules/server.ts` and `import "./<name>/client"` to `src/modules/client.ts`.

Storage lives in `dashboard.db` (SQLite). Layout is the `widgets` table; cached fetch results live in `widget_cache`.
