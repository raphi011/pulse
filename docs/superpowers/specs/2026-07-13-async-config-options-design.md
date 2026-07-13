# Schema-declared async config options (live dropdowns)

**Date:** 2026-07-13
**Status:** Approved, ready for planning

## Problem

Widget config forms auto-generate from a static Zod schema (`src/components/schema-form.tsx`).
Only `enum` renders as a `<select>`, and an enum is *static* — its members are baked into
the schema at author time. Several config fields are really **IDs the user must currently
paste by hand**, even though the source system can list the valid choices live:

| Widget | Field | Today | Should be |
|--------|-------|-------|-----------|
| `gws.tasks` | `tasklist` (string) | paste task-list ID | dropdown of task lists |
| `gws.calendar` | `calendarId` (string) | paste calendar ID | dropdown of calendars |
| `gws.nextMeeting` | `calendarId` (string) | paste calendar ID | dropdown of calendars |
| `gws.chatChannels` | `spaceIds` (string[]) | paste `spaces/…` IDs | multi-select of spaces |

There is no mechanism for a field whose options come from an integration call.

## Goal

A **reusable, schema-declared** mechanism: a field opts into live options with one line
on its Zod definition, and the generic form renders the right control. The shell learns
nothing widget-specific; each future ID field (github repos, etc.) becomes a one-line opt-in.

Non-goal: changing stored config shapes. `tasklist`/`calendarId` stay strings, `spaceIds`
stays `string[]`; defaults (`@default`, `primary`) are unchanged. No `CACHE_VERSION` bump.

## Design

### 1. Declaration lives in the field (single source of truth)

Zod 4's `.meta()` survives `z.toJSONSchema()` (verified, zod 4.4.3), so the "options come
from here" marker rides along with the field:

```ts
tasklist: z.string().default("@default")
  .meta({ optionsKey: "gws.taskLists" })
  .describe("Task list")
```

`optionsKey` is a string id into a provider registry — never a function (functions can't
be serialized, and the schema must stay JSON-encodable).

### 2. Field-options registry — `src/modules/field-options.ts`

Mirrors the existing fetch/render registry pattern. Module-owned, shell-agnostic.

```ts
export type FieldOption = { value: string; label: string };
type Provider = () => Promise<FieldOption[]>;
const registry = new Map<string, Provider>();
export function registerFieldOptions(key: string, provider: Provider): void { … }
export function getFieldOptionsProvider(key: string): Provider | undefined { … }
```

Providers register at app start via each module's `fetch.ts` (side-effect-imported by
`app-root.tsx` through `@/modules/fetch`), next to `registerFetch`.

### 3. gws providers — `src/modules/gws/options.ts`

Thin CLI wrappers, one per source. Each maps the `gws` JSON to `FieldOption[]`:

- `"gws.taskLists"` → `gws tasks tasklists list` → `items[]` → `{ value: id, label: title }`
- `"gws.calendars"` → `gws calendar calendarList list` → `items[]` →
  `{ value: id, label: summary }`; the `primary` calendar is labeled `"<summary> (primary)"`
- `"gws.chatSpaces"` → `gws chat spaces list` → `spaces[]` →
  `{ value: name, label: displayName || name }`

Reuse the module's `gwsJson` helper, so API errors (auth, scopes) throw `CliError` exactly
like the widgets' own fetches. Registered in `gws/fetch.ts`.

### 4. `describeSchema` — two new field kinds

Read `optionsKey` off the JSON-schema property and branch on the underlying type:

- `optionsKey` + `type: "string"` → `kind: "asyncEnum"` (carries `optionsKey`)
- `optionsKey` + `type: "array"` of string → `kind: "asyncMultiEnum"` (carries `optionsKey`)

Fields without `optionsKey` are unchanged. `JsonProp`/`Field` gain an optional
`optionsKey`.

### 5. `SchemaForm` — render the async controls

Each field row already renders once per key, so async fields are extracted into small
child components (one component instance per field → hooks are called unconditionally and
in stable order). Both use TanStack Query (`useQuery(["field-options", key], provider)`),
which the config dialog already has context for.

**`AsyncEnumField`** (`<select>`):
- **loading** → disabled `<select>` showing the current value
- **loaded** → options; the currently-stored value is always present as an option even if
  the fetch omits it (so a stale/renamed selection is never silently dropped)
- **error / empty / no provider** → graceful fallback to the plain text input, so the
  widget stays configurable offline or when a scope is missing

**`AsyncMultiEnumField`** (checklist):
- **loaded** → checkbox list of options; values already selected but absent from the fetch
  appear as extra checked rows so nothing is lost
- **loading** → checklist disabled, current selections shown
- **error / empty / no provider** → fallback to the existing `StringListEditor`

### 6. Schema opt-ins (`src/modules/gws/manifest.ts`)

- `tasks.tasklist` → `.meta({ optionsKey: "gws.taskLists" })`, label `"Task list"`
- `calendar.calendarId` & `nextMeeting.calendarId` → `.meta({ optionsKey: "gws.calendars" })`,
  label `"Calendar"` (both reuse the one provider)
- `chatChannels.spaceIds` → `.meta({ optionsKey: "gws.chatSpaces" })`; the hand-run
  "run `gws chat spaces list`" hint in its `.describe()` is removed

## Data flow

```
config dialog opens
  → SchemaForm.describeSchema(schema)  reads optionsKey → asyncEnum / asyncMultiEnum
    → Async*Field  useQuery(key) → getFieldOptionsProvider(key)() → gws CLI → FieldOption[]
      → <select> / checklist   (loading / loaded / error-fallback states)
        → onChange writes value(s) into config exactly as the string/stringList fields did
```

Stored value is identical to today's; only the *input control* changes. Save path,
validation (`widget-service`), and caching are untouched.

## Error handling

- Provider throws (auth, insufficient scopes, CLI missing) → `useQuery` error → the field
  falls back to free-text entry. The user can still type an ID, so a broken/unauthorized
  list never blocks configuration. (Observed live: `gws chat spaces list` currently returns
  403 "insufficient authentication scopes" — the fallback path covers exactly this.)
- Unknown `optionsKey` (provider not registered) → treated as error → text fallback.

## Testing

- `field-options` registry: register/get, unknown key returns `undefined`.
- `describeSchema`: a string field with `optionsKey` → `asyncEnum`; a `z.array(z.string())`
  field with `optionsKey` → `asyncMultiEnum`; plain fields unchanged.
- gws providers: mock `gwsJson`, assert JSON → `FieldOption[]` mapping (incl. `primary`
  calendar label, `displayName` fallback).
- `SchemaForm` (Testing Library + `QueryClientProvider`, mocked provider):
  asyncEnum shows options once loaded and injects the current value when missing;
  on provider error it renders the text input fallback.
- Existing gws registration test unchanged (registry still resolves every widget type).

## Reusability payoff

Adding a live dropdown to any future ID field is a one-line `.meta({ optionsKey })` plus a
small provider — e.g. `github` repos (`gh repo list`) or authors could adopt the exact same
path later. No second config-form code path is introduced; the registry, `describeSchema`
branch, and provider each have a single, testable job.
