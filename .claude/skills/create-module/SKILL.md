---
name: create-module
description: Use when adding a new integration to the work-dashboard (a new data source or widget — e.g. GitHub, Jira, Google Workspace), scaffolding a module under src/modules/, or registering a new widget type. Covers the manifest/fetch/render split, registry wiring, config-form constraints, CLI-backed fetching, and the registration test.
---

# Create a Dashboard Module

A **module** is a self-contained integration under `src/modules/<name>/` owning one or
more **widget types**. Vocabulary is pinned in `CONTEXT.md` — read it first. The shell
only knows the widget contract (`src/modules/contracts.ts`); it never imports a module.

Reference modules to copy: **`jira`** (single widget, custom-query config, CLI-backed) and
**`github`** (three widgets, N+1 enrichment). Match their shape.

## Files (single-widget module)

```
src/modules/<name>/
  manifest.ts          # type id, Zod config schema + default, data shapes. NO runtime deps.
  <cli>.ts             # (CLI-backed only) runCli wrapper + auth regex
  <feature>.ts         # server-only fetch(config): Promise<Data>
  fetch.ts             # registerFetchWidget({ type, configSchema, defaultConfig, fetch })
  render.ts            # registerRenderWidget({ type, title, Component, configSchema, defaultConfig })
  widgets/<name>-widget.tsx   # "use client" body: (props: WidgetBodyProps<Data, Config>)
```

Multiple widget types? One `manifest.ts`, one `fetch.ts`, one `render.ts`; add a
`<feature>.ts` + `widgets/*.tsx` per type (see `github`).

## Steps

1. **manifest.ts** — export a `<X>_TYPE = "<name>.<feature>"` string, a `zod` config schema,
   its `type` + `default`, and the `Data` shape returned by `fetch`.
2. **fetch** — server-only (`import "server-only"`), pure `fetch(config): Promise<Data>`.
   CLI-backed: call your wrapper. Errors thrown here surface as the widget's error state.
3. **widget** — `"use client"`, render from `data`/`config`. Match existing widgets'
   Tailwind (list rows, `text-ok/warn/danger`, dark variants). Handle the empty case.
4. **fetch.ts + render.ts** — register into each registry.
5. **Wire the barrels** — add `import "./<name>/fetch";` to `src/modules/fetch.ts` and
   `import "./<name>/render";` to `src/modules/render.ts`. **Both, or it won't appear.**
   Registering in the render registry auto-adds it to the "Add widget" drawer — no DB seeding.
6. **Test** — add `tests/modules/<name>-registration.test.ts` (copy jira's) asserting both
   registries resolve the type with the expected title/defaults.

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

## CLI-backed fetch

Everything runs through `runCli` (`src/server/cli.ts`) — spawns via `execFile`, **no shell**,
pass an **arg array** (never build a command string). Pick the wrapper by how the CLI reports
errors:

**Process-model CLI** (errors on stderr, non-zero exit, auth detectable by a stderr string —
e.g. `gh`, `jira`). Wrap `runCli` with an auth regex, like `github/gh.ts` / `jira/jira.ts`:

```ts
import "server-only";
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
import "server-only";
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
- `npm run lint` and `npm run build`.
- Drive the **real fetch** end-to-end. There's no widget-list GET and no UI automation, so use
  the API against `npm run dev` (writes to `dashboard.db` — delete the test widgets after):

  ```bash
  base=http://localhost:3000
  id=$(curl -s -X POST $base/api/widgets -H 'content-type: application/json' \
        -d '{"type":"<name>.<feature>"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
  curl -s "$base/api/widgets/$id/data?refresh=1"   # status:"ok" + real payload
  curl -s -X DELETE "$base/api/widgets/$id"         # clean up
  ```
  `GET /api/layout` lists existing widgets (use it to find/clean stragglers). Confirm the
  widget also renders a clean error when the CLI is unauthenticated.

## Common mistakes

- Wired only one barrel → widget missing from drawer, or data route can't fetch.
- Unsupported config field kind (object, nested array, union) → form throws at render.
- Building shell command strings → pass an arg array to `runCli`; never interpolate into a shell.
- `fetch` swallowing errors and returning empty → let it throw; the cache keeps last-good data.
- Forgetting the empty-state render in the widget body.
