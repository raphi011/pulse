# Work Dashboard

Local, single-user, pluggable work dashboard.

## Develop
- `npm run dev` — start dev server
- `npm test` — run tests
- `npm run db:generate` / `npm run db:migrate` — schema migrations

## Add a module
1. Create `src/modules/<name>/manifest.ts` (types, Zod config, defaults).
2. `server.ts` — call `registerServerWidget({ type, configSchema, defaultConfig, fetch })`.
3. `widgets/*.tsx` + `client.ts` — call `registerClientWidget({ type, title, Component })`.
4. Add `import "./<name>/server"` to `src/modules/server.ts` and `import "./<name>/client"` to `src/modules/client.ts`.

Storage lives in `dashboard.db` (SQLite). Layout is the `widgets` table; cached fetch results live in `widget_cache`.
