---
name: create-module
description: Use when adding a new integration to the work-dashboard (a new data source or widget — e.g. GitHub, Jira, Google Workspace, system stats), scaffolding a module under src/modules/, or registering a new widget type. Covers the manifest/fetch/render split, registry + integration wiring, config-form constraints, CLI-backed and live Tauri-command fetching, and the registration test.
---

# Create a Dashboard Module

A **module** is a self-contained integration under `src/modules/<name>/` owning one or
more **widget types**. Vocabulary is pinned in `CONTEXT.md` — read it first. The shell
only knows the widget contract (`src/modules/contracts.ts`); it never imports a module.

Reference modules to copy: **`jira`** (single widget, custom-query config, CLI-backed),
**`github`** (three widgets, N+1 enrichment), **`bookmarks`** (local-data module — no
CLI, no external fetch, its own DB table; see "Local-data modules" below), and
**`system`** (live module — Tauri command + in-webview sampler, no cache; see "Live
modules" below).

## Files (single-widget module)

```
src/modules/<name>/
  manifest.ts          # type id, Zod config schema + default, data shapes, and a
                        # WidgetManifest per widget type via defineManifest(). NO runtime deps.
  <cli>.ts             # (CLI-backed only) runCli/runJsonCli wrapper + auth detection
  integration.ts       # (only if manifest sets `integration`) registerIntegration(...) — see step 5
  <feature>.ts         # fetch(config): Promise<Data>
  fetch.ts             # registerFetch(manifest, { fetch })
  render.ts            # registerRender(manifest, { Component, icon?, count?, HeaderControls?, formEditable? })
  widgets/<name>-widget.tsx   # body: (props: WidgetBodyProps<Data, Config>)
  repo.ts              # (local-data modules only) module-owned table + CRUD — see below
```

Multiple widget types? One `manifest.ts` (one `defineManifest()` call per type), one
`fetch.ts`, one `render.ts`; add a `<feature>.ts` + `widgets/*.tsx` per type (see `github`).

## Steps

1. **manifest.ts** — export a `<X>_TYPE = "<name>.<feature>"` string, a Zod config schema +
   its inferred type + default, the `Data` shape returned by `fetch`, and the manifest itself:

   ```ts
   export const fooManifest = defineManifest({
     type: FOO_TYPE, title: "Foo",
     configSchema: fooConfigSchema, defaultConfig: fooDefaultConfig,
     integration: "example", // omit for always-available widgets (e.g. bookmarks, core)
   });
   ```

2. **fetch** — pure `fetch(config): Promise<Data>`. CLI-backed: call your wrapper. Errors
   thrown here surface as the widget's error state.
3. **widget** — render from `data`/`config`. Match existing widgets' Tailwind (list rows,
   `text-ok/warn/danger`, dark variants). Handle the empty case.
4. **fetch.ts + render.ts** — register into each registry:

   ```ts
   // fetch.ts
   registerFetch(fooManifest, { fetch: fetchFoo });

   // render.ts
   registerRender(fooManifest, {
     Component: FooWidget,
     count: (d) => d.items.length,
     icon: { Icon: SiExample, className: "text-[#123456]" },
   });
   ```

5. **Declare the integration** (only if the manifest sets `integration`) — add
   `src/modules/<name>/integration.ts` and import it in `src/modules/integrations.ts`:

   ```ts
   import { registerIntegration } from "@/modules/integration-registry";
   import { probeHealth } from "@/modules/integration-health";
   import { runX } from "./x";

   registerIntegration({
     id: "example", // must match manifest.integration
     name: "Example",
     tool: { bin: "x", installHint: "brew install x", authHint: "Run `x auth login`." },
     checkHealth: () => probeHealth(() => runX(["auth", "status"])),
   });
   ```

   The add-widget drawer only lists types whose integration id is **declared and enabled**
   — a manifest `integration` with no matching `registerIntegration` silently hides the
   widget. Add the id to `tests/modules/integrations-registration.test.ts`.
6. **Wire the barrels** — add `import "./<name>/fetch";` to `src/modules/fetch.ts` and
   `import "./<name>/render";` to `src/modules/render.ts`. **Both, or it won't appear.**
   Registering in the render registry auto-adds it to the "Add widget" drawer — no DB seeding.
7. **Test** — add `tests/modules/<name>-registration.test.ts` (copy `bookmarks-registration.test.ts`
   or `jira-registration.test.ts`) asserting:
   - the fetch registry resolves the type with the expected `manifest.defaultConfig` and a
     `fetch` function;
   - the render registry resolves the type with the expected `manifest.title`, `configSchema`,
     and any render-only seams (`formEditable`, `HeaderControls`, etc.);
   - **both sides share the same manifest object** — `expect(getFetchWidget(TYPE)!.manifest).toBe(getRenderWidget(TYPE)!.manifest)`. This is the guarantee that fetch and render can't drift on type/title/schema/defaults.

## Widget body props

`WidgetBodyProps<Data, Config> = { data, config, refresh }`. There is no action/RPC API —
if a widget needs to mutate anything, it does so directly (see "Local-data modules" below)
and then calls `refresh()` to re-fetch and re-render with the result. `refresh()` is the same
function the header's refresh button calls.

## Local-data modules

Some widgets own their data locally instead of fetching it from a CLI/API — e.g. `bookmarks`.
Shape (copy `src/modules/bookmarks/`):

- `repo.ts` — a module-owned Drizzle table (add it to `src/db/schema.ts` + a migration) with
  plain async CRUD functions (`listX`, `addX`, `removeX`), reached via `getDb()` like any
  other repo.
- `manifest.ts` — `configSchema`/`defaultConfig` stay empty (`z.object({})`) unless the widget
  also has real per-instance settings; the data itself never lives in config.
  `refreshable: false` if there's nothing to auto-poll (mutations already call `refresh()`).
- `fetch.ts` — `fetch()` just reads the repo (e.g. `listBookmarks()`) and shapes it into `Data`.
- `widgets/<name>-widget.tsx` — imports the repo's mutation functions directly (`addBookmark`,
  `removeBookmark`), calls them from event handlers, then `await refresh()` to reflect the
  change. No server boundary to cross — the webview runs everything.
- `render.ts` — often adds a `HeaderControls` component (e.g. an "add" popover) alongside
  `formEditable: false` when the auto-generated config form has nothing useful to show.

## Live modules (Tauri-command-backed)

Widgets whose data is sampled live in the webview instead of fetched-and-cached — e.g.
`system` (CPU/memory charts). Shape (copy `src/modules/system/`):

- **Rust side** — a Tauri command in `src-tauri/src/<name>.rs`; register it in `lib.rs`
  (`mod`, any `.manage(...)` state, and the `generate_handler![...]` list). Call it from
  TS with `invoke<Payload>("<command>")`. Keep the payload keys pinned in `manifest.ts`
  (serde camelCase).
- `sampler.ts` — module-level singleton (ticker + ring buffer) **outside React**, so the
  rolling history survives card drag/remount. Starts on first subscriber, stops at zero,
  pauses while the window is hidden. Exposes `subscribe`/`getSnapshot`/`configure`.
- `use-<x>.ts` — hook: `useSyncExternalStore(sampler.subscribe, sampler.getSnapshot)`
  plus an effect that `configure()`s the sampler from widget config. **`safeParse` the
  config before it reaches any timer** — after a breaking schema change the body can
  receive stale invalid config, and e.g. `setInterval(cb, NaN)` fires unthrottled; fall
  back to the schema defaults.
- `manifest.ts` — `refreshable: false`; `Data = Record<string, never>`; `fetch` is a
  contract no-op returning `{}` (the cache pipeline carries no data for live widgets).
- Tolerate transient failures: flip to an error state only after N consecutive failed
  ticks so a single hiccup doesn't flicker the card.

## Config schema → form (hard constraint)

The settings form is auto-generated from the Zod schema by `src/components/schema-form.tsx`.
Only these field kinds render — anything else **throws**:

| Kind | Zod |
|------|-----|
| string | `z.string()` |
| number | `z.number().int()...` |
| boolean | `z.boolean()` |
| stringList | `z.array(z.string())` |
| enum | `z.enum([...])` |

`.describe("Label")` sets the field label. Give every field a sensible `.default(...)`.
Set `formEditable: false` on the render registration for modules with no useful config
(the Configure dialog then hides the auto-generated form).

## CLI-backed fetch

Everything runs through `runCli`/`runJsonCli` (`src/server/cli.ts`) — spawns via
`tauri-plugin-shell`'s `Command` with a Homebrew-inclusive `PATH` prepended (so a
Finder-launched `.app` still finds `gh`/`jira`/`gws`), passing an **arg array** (never build
a shell command string). Pick the wrapper by how the CLI reports errors:

**Process-model CLI** (errors on stderr, non-zero exit, auth detectable by a stderr string —
e.g. `gh`, `jira`). Wrap `runCli` with an auth regex, like `github/gh.ts` / `jira/jira.ts`:

```ts
import { runCli } from "@/server/cli";

const AUTH = /not authenticated|401|invalid credentials/i;

export async function xJson<T>(args: string[]): Promise<T> {
  const { stdout } = await runCli("x", args, {
    notAuthenticatedPattern: AUTH,
    notAuthenticatedMessage: "Not authenticated — run `x auth login`",
  });
  return JSON.parse(stdout) as T;
}
```

**Payload-model CLI** (thin REST-API wrapper: errors come back as JSON *inside* stdout,
possibly with a **zero exit code** — e.g. `gws` returns HTTP 401 as exit 0). The stderr/exit
signal is useless here, so use `runJsonCli` with an error extractor, like `gws/gws.ts`:

```ts
import { runJsonCli, type ApiError } from "@/server/cli";

const extractError = (b: unknown): ApiError | null =>
  (b as { error?: { code?: number; message?: string } }).error ?? null; // 401/403 → auth

export const xJson = <T>(args: string[]) =>
  runJsonCli<T>("x", args, extractError, { notAuthenticatedMessage: "Not authenticated — run `x auth login`" });
```

**Confirm CLI behavior with real calls before coding** — CLIs lie about their contracts.
(gws example: passing `metadataHeaders` to `gmail messages get` silently drops all headers;
`format=metadata` alone returns them.)

**N+1 enrichment** (list → per-item detail): run the per-item calls with `Promise.allSettled`
and drop/fall back on rejection, so one failure doesn't sink the widget (`github/prs.ts`, `gws/gmail.ts`).

## Verify (don't skip)

- `npm test` — new registration test + suite green.
- `npm run lint`, `npx tsc --noEmit`, and `npm run build`.
- Drive the **real fetch** end-to-end: `npm run dev` (launches Rust + webview), then in the
  app **Edit → + Add widget → <your widget>**. Confirm it renders real data, the refresh
  button re-fetches, and — for CLI-backed modules — that it shows a clean in-card error when
  the CLI is unauthenticated (log out of the CLI, or temporarily break `notAuthenticatedPattern`).
  Remove the test widget afterward (Edit → remove) unless you want to keep it.

## Common mistakes

- Wired only one barrel → widget missing from drawer, or nothing to fetch its data.
- Manifest sets `integration: "x"` but no `registerIntegration({ id: "x", ... })` wired in
  `src/modules/integrations.ts` → widget silently absent from the drawer.
- Unsupported config field kind (object, nested array, union) → form throws at render.
- Building shell command strings → pass an arg array to `runCli`; never interpolate into a shell.
- `fetch` swallowing errors and returning empty → let it throw; the cache keeps last-good data.
- Forgetting the empty-state render in the widget body.
- Local-data module putting its data in widget `config` instead of its own repo table — config
  is per-widget settings, not user content, and isn't meant to grow unbounded.
