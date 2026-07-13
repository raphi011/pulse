# Async Config Options (Live Dropdowns) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a widget config field render a live dropdown of options fetched from its integration, declared with one line of Zod `.meta()`, and apply it to the gws task-list, calendar, and chat-space fields.

**Architecture:** A field declares `optionsKey` via `.meta()` (survives `z.toJSONSchema`). `describeSchema` turns that into an `asyncEnum` / `asyncMultiEnum` field kind. `SchemaForm` renders those via TanStack Query against a module-owned **field-options registry**; providers wrap `gws` CLI list calls. Every async control falls back to plain text entry on error, so a missing scope or offline CLI never blocks configuration.

**Tech Stack:** React 19, TypeScript, Zod 4, TanStack Query, Vitest + Testing Library, the `gws` CLI via `gwsJson`.

## Global Constraints

- Personal project: **plain conventional commits, no Jira prefix** (e.g. `feat: …`).
- Match existing patterns; keep changes surgical. Feature-flag toggles default disabled (N/A here).
- **No stored-config shape changes.** `tasklist`/`calendarId` stay `string`, `spaceIds` stays `string[]`; defaults `@default` / `primary` / `[]` unchanged. **No `CACHE_VERSION` bump.**
- All repo/registry functions that touch the DB are async; providers here only call `gwsJson` (already async).
- Providers register at app start through each module's `fetch.ts` (side-effect-imported by `app-root.tsx` via `@/modules/fetch`).
- `FieldOption = { value: string; label: string }` is the one option shape used everywhere.

---

### Task 1: Field-options registry

**Files:**
- Create: `src/modules/field-options.ts`
- Test: `tests/modules/field-options.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type FieldOption = { value: string; label: string }`
  - `registerFieldOptions(key: string, provider: () => Promise<FieldOption[]>): void` — throws on duplicate key
  - `getFieldOptionsProvider(key: string): (() => Promise<FieldOption[]>) | undefined`
  - `__clearFieldOptionsRegistry(): void` (test helper)

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/field-options.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  registerFieldOptions,
  getFieldOptionsProvider,
  __clearFieldOptionsRegistry,
  type FieldOption,
} from "@/modules/field-options";

beforeEach(() => __clearFieldOptionsRegistry());

describe("field-options registry", () => {
  it("registers and resolves a provider by key", async () => {
    const opts: FieldOption[] = [{ value: "a", label: "A" }];
    registerFieldOptions("k", async () => opts);
    const provider = getFieldOptionsProvider("k");
    expect(provider).toBeTypeOf("function");
    await expect(provider!()).resolves.toEqual(opts);
  });

  it("returns undefined for an unknown key", () => {
    expect(getFieldOptionsProvider("missing")).toBeUndefined();
  });

  it("throws when the same key is registered twice", () => {
    registerFieldOptions("dup", async () => []);
    expect(() => registerFieldOptions("dup", async () => [])).toThrow(/already registered/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/field-options.test.ts`
Expected: FAIL — cannot resolve `@/modules/field-options`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/field-options.ts

/** One selectable option for an async config dropdown. */
export type FieldOption = { value: string; label: string };

type Provider = () => Promise<FieldOption[]>;

const registry = new Map<string, Provider>();

/** Register the live-options source for a config field's `optionsKey`. */
export function registerFieldOptions(key: string, provider: Provider): void {
  if (registry.has(key)) throw new Error(`Field options already registered: ${key}`);
  registry.set(key, provider);
}

export function getFieldOptionsProvider(key: string): Provider | undefined {
  return registry.get(key);
}

export function __clearFieldOptionsRegistry(): void {
  registry.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/field-options.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/field-options.ts tests/modules/field-options.test.ts
git commit -m "feat: field-options registry for live config dropdowns"
```

---

### Task 2: `describeSchema` — asyncEnum / asyncMultiEnum kinds

**Files:**
- Modify: `src/components/schema-form.tsx` (types `FieldKind`, `Field`, `JsonProp`; function `describeSchema`)
- Test: `tests/components/schema-form.test.ts`

**Interfaces:**
- Consumes: `FieldOption` is not needed here; only the string `optionsKey`.
- Produces:
  - `FieldKind` gains `"asyncEnum"` and `"asyncMultiEnum"`.
  - `Field` gains optional `optionsKey?: string`.
  - `describeSchema` emits `{ kind: "asyncEnum", optionsKey }` for a `string` prop carrying `optionsKey`, and `{ kind: "asyncMultiEnum", optionsKey }` for a string-array prop carrying `optionsKey`.

- [ ] **Step 1: Write the failing test** (append to existing `describe("describeSchema", …)` block)

```ts
// tests/components/schema-form.test.ts — add these two cases inside the existing describe
  it("derives an asyncEnum for a string field carrying optionsKey", () => {
    const schema = z.object({
      tasklist: z.string().default("@default").meta({ optionsKey: "gws.taskLists" }).describe("Task list"),
    });
    expect(describeSchema(schema)).toEqual([
      { key: "tasklist", label: "Task list", kind: "asyncEnum", optionsKey: "gws.taskLists", def: "@default" },
    ]);
  });

  it("derives an asyncMultiEnum for a string-array field carrying optionsKey", () => {
    const schema = z.object({
      spaceIds: z.array(z.string()).default([]).meta({ optionsKey: "gws.chatSpaces" }).describe("Spaces"),
    });
    expect(describeSchema(schema)).toEqual([
      { key: "spaceIds", label: "Spaces", kind: "asyncMultiEnum", optionsKey: "gws.chatSpaces", def: [] },
    ]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/schema-form.test.ts`
Expected: FAIL — received `kind: "string"` / `"stringList"` with no `optionsKey`.

- [ ] **Step 3: Write minimal implementation**

In `src/components/schema-form.tsx`:

Change the `FieldKind` and `Field` types:

```ts
export type FieldKind = "string" | "number" | "boolean" | "stringList" | "enum" | "asyncEnum" | "asyncMultiEnum";
export type Field = { key: string; label: string; kind: FieldKind; options?: string[]; optionsKey?: string; def?: unknown };
```

Add `optionsKey` to `JsonProp`:

```ts
type JsonProp = {
  type?: string; description?: string; default?: unknown;
  enum?: string[]; items?: { type?: string }; optionsKey?: string;
};
```

In `describeSchema`, inside the `.map`, add the `optionsKey` branch **before** the existing `enum`/`switch` logic:

```ts
  return Object.entries(props).map(([key, p]) => {
    const label = p.description ?? humanize(key);
    const def = p.default;
    if (p.optionsKey) {
      if (p.type === "string") return { key, label, kind: "asyncEnum", optionsKey: p.optionsKey, def };
      if (p.type === "array" && p.items?.type === "string")
        return { key, label, kind: "asyncMultiEnum", optionsKey: p.optionsKey, def };
      throw new Error(`optionsKey on unsupported field "${key}": ${p.type}`);
    }
    if (Array.isArray(p.enum)) return { key, label, kind: "enum", options: p.enum, def };
    // …existing switch unchanged…
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/schema-form.test.ts`
Expected: PASS (all cases, including the two originals).

- [ ] **Step 5: Commit**

```bash
git add src/components/schema-form.tsx tests/components/schema-form.test.ts
git commit -m "feat: describeSchema detects optionsKey (asyncEnum / asyncMultiEnum)"
```

---

### Task 3: `SchemaForm` renders the async controls

**Files:**
- Modify: `src/components/schema-form.tsx` (add `AsyncEnumField` + `AsyncMultiEnumField` components; wire into the `SchemaForm` field map)
- Test: `tests/components/schema-form-async.test.tsx`

**Interfaces:**
- Consumes: `getFieldOptionsProvider` (Task 1), `Field.optionsKey` + kinds (Task 2), `useQuery` from `@tanstack/react-query`.
- Produces: no new exports; `SchemaForm` now renders `asyncEnum` as a `<select>` and `asyncMultiEnum` as a checkbox list, each with a text fallback.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/schema-form-async.test.tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { z } from "zod";
import { SchemaForm } from "@/components/schema-form";
import {
  registerFieldOptions,
  __clearFieldOptionsRegistry,
  type FieldOption,
} from "@/modules/field-options";

const schema = z.object({
  tasklist: z.string().default("@default").meta({ optionsKey: "test.lists" }).describe("Task list"),
});

function renderForm(values: Record<string, unknown>) {
  const onChange = vi.fn();
  render(
    // retry:false so an erroring provider settles immediately in the test
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SchemaForm schema={schema} values={values} onChange={onChange} />
    </QueryClientProvider>,
  );
  return onChange;
}

beforeEach(() => __clearFieldOptionsRegistry());

describe("SchemaForm asyncEnum", () => {
  it("renders fetched options in a select", async () => {
    const opts: FieldOption[] = [
      { value: "id1", label: "Tasks" },
      { value: "id2", label: "Other" },
    ];
    registerFieldOptions("test.lists", async () => opts);
    renderForm({ tasklist: "id2" });
    const select = await screen.findByRole("combobox", { name: "Task list" });
    await waitFor(() => expect(screen.getByRole("option", { name: "Other" })).toBeInTheDocument());
    expect(select).toHaveValue("id2");
  });

  it("keeps the current value as an option when the fetch omits it", async () => {
    registerFieldOptions("test.lists", async () => [{ value: "id1", label: "Tasks" }]);
    renderForm({ tasklist: "stale-id" });
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Task list" })).toHaveValue("stale-id"),
    );
  });

  it("falls back to a text input when the provider errors", async () => {
    registerFieldOptions("test.lists", async () => {
      throw new Error("403 insufficient scopes");
    });
    renderForm({ tasklist: "id1" });
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Task list" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("textbox", { name: "Task list" })).toHaveValue("id1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/schema-form-async.test.tsx`
Expected: FAIL — asyncEnum currently renders nothing (no branch), so `combobox` is not found.

- [ ] **Step 3: Write minimal implementation**

In `src/components/schema-form.tsx`:

Add imports at the top (keep the existing `useState` import):

```ts
import { useQuery } from "@tanstack/react-query";
import { getFieldOptionsProvider, type FieldOption } from "@/modules/field-options";
```

Add these two components above `SchemaForm` (after `StringListEditor`):

```tsx
function useFieldOptions(optionsKey: string) {
  const provider = getFieldOptionsProvider(optionsKey);
  return useQuery({
    queryKey: ["field-options", optionsKey],
    queryFn: () => provider!(),
    enabled: Boolean(provider),
    staleTime: 5 * 60_000,
  });
}

function AsyncEnumField({
  id, label, optionsKey, value, onChange,
}: {
  id: string; label: string; optionsKey: string;
  value: string; onChange: (v: string | undefined) => void;
}) {
  const provider = getFieldOptionsProvider(optionsKey);
  const { data, isLoading, isError } = useFieldOptions(optionsKey);

  // No provider, or the fetch failed → plain text entry so the field still works.
  if (!provider || isError) {
    return (
      <input
        id={id}
        aria-label={label}
        className={inputCls}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  const options: FieldOption[] = data ?? [];
  // Always show the current value, even if the fetch omitted it (stale/renamed selection).
  const hasCurrent = value === "" || options.some((o) => o.value === value);

  return (
    <select
      id={id}
      aria-label={label}
      className={inputCls}
      disabled={isLoading}
      value={value}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">Default</option>
      {!hasCurrent && <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function AsyncMultiEnumField({
  id, label, optionsKey, value, onChange,
}: {
  id: string; label: string; optionsKey: string;
  value: string[]; onChange: (v: string[]) => void;
}) {
  const provider = getFieldOptionsProvider(optionsKey);
  const { data, isError } = useFieldOptions(optionsKey);

  if (!provider || isError) {
    return <StringListEditor id={id} value={value} onChange={onChange} />;
  }

  const options: FieldOption[] = data ?? [];
  // Selected values missing from the fetch still appear so nothing is silently dropped.
  const extras = value.filter((v) => !options.some((o) => o.value === v)).map((v) => ({ value: v, label: v }));
  const toggle = (v: string, on: boolean) =>
    onChange(on ? [...value, v] : value.filter((x) => x !== v));

  return (
    <div role="group" aria-label={label} className="space-y-1.5">
      {[...options, ...extras].map((o) => (
        <label key={o.value} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            className="h-4 w-4 rounded accent-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
            checked={value.includes(o.value)}
            onChange={(e) => toggle(o.value, e.target.checked)}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}
```

In `SchemaForm`'s field `.map`, add the two branches next to the existing `string` / `stringList` branches (inside the non-boolean `<div>` that already renders the `<label htmlFor={id}>`):

```tsx
            {f.kind === "asyncEnum" && (
              <AsyncEnumField
                id={id} label={f.label} optionsKey={f.optionsKey!}
                value={String(values[f.key] ?? "")}
                onChange={(v) => set(f.key, v)}
              />
            )}
            {f.kind === "asyncMultiEnum" && (
              <AsyncMultiEnumField
                id={id} label={f.label} optionsKey={f.optionsKey!}
                value={(values[f.key] as string[]) ?? []}
                onChange={(v) => set(f.key, v)}
              />
            )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/schema-form-async.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/schema-form.tsx tests/components/schema-form-async.test.tsx
git commit -m "feat: SchemaForm renders asyncEnum + asyncMultiEnum controls"
```

---

### Task 4: gws option providers

**Files:**
- Create: `src/modules/gws/options.ts`
- Modify: `src/modules/gws/fetch.ts` (register the three providers)
- Test: `tests/modules/gws-options.test.ts`

**Interfaces:**
- Consumes: `gwsJson` from `@/modules/gws/gws`; `FieldOption` (Task 1); `registerFieldOptions` (Task 1).
- Produces (exported for unit testing, pure mappers + async fetchers):
  - `TASK_LISTS_KEY = "gws.taskLists"`, `CALENDARS_KEY = "gws.calendars"`, `CHAT_SPACES_KEY = "gws.chatSpaces"`
  - `fetchTaskListOptions(): Promise<FieldOption[]>`
  - `fetchCalendarOptions(): Promise<FieldOption[]>`
  - `fetchChatSpaceOptions(): Promise<FieldOption[]>`
  - `registerGwsFieldOptions(): void` — registers all three

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/gws-options.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/modules/gws/gws", () => ({ gwsJson: vi.fn() }));
import { gwsJson } from "@/modules/gws/gws";
import {
  fetchTaskListOptions, fetchCalendarOptions, fetchChatSpaceOptions,
} from "@/modules/gws/options";

const mockJson = gwsJson as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => mockJson.mockReset());

describe("gws option providers", () => {
  it("maps task lists to id/title options", async () => {
    mockJson.mockResolvedValue({ items: [
      { id: "MDYx", title: "Tasks" },
      { id: "ZDFr", title: "Other" },
    ] });
    await expect(fetchTaskListOptions()).resolves.toEqual([
      { value: "MDYx", label: "Tasks" },
      { value: "ZDFr", label: "Other" },
    ]);
    expect(mockJson).toHaveBeenCalledWith(["tasks", "tasklists", "list"]);
  });

  it("labels the primary calendar and maps the rest by summary", async () => {
    mockJson.mockResolvedValue({ items: [
      { id: "raphi@gmail.com", summary: "Personal", primary: true },
      { id: "fam@group", summary: "Family" },
    ] });
    await expect(fetchCalendarOptions()).resolves.toEqual([
      { value: "raphi@gmail.com", label: "Personal (primary)" },
      { value: "fam@group", label: "Family" },
    ]);
    expect(mockJson).toHaveBeenCalledWith(["calendar", "calendarList", "list"]);
  });

  it("maps chat spaces to name/displayName, falling back to the id", async () => {
    mockJson.mockResolvedValue({ spaces: [
      { name: "spaces/AAA", displayName: "Team" },
      { name: "spaces/BBB" },
    ] });
    await expect(fetchChatSpaceOptions()).resolves.toEqual([
      { value: "spaces/AAA", label: "Team" },
      { value: "spaces/BBB", label: "spaces/BBB" },
    ]);
    expect(mockJson).toHaveBeenCalledWith(["chat", "spaces", "list"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/gws-options.test.ts`
Expected: FAIL — cannot resolve `@/modules/gws/options`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/gws/options.ts
import { gwsJson } from "./gws";
import { registerFieldOptions, type FieldOption } from "@/modules/field-options";

export const TASK_LISTS_KEY = "gws.taskLists";
export const CALENDARS_KEY = "gws.calendars";
export const CHAT_SPACES_KEY = "gws.chatSpaces";

type ListResp = { id: string; title?: string }[];
type CalItem = { id: string; summary?: string; primary?: boolean };
type SpaceItem = { name: string; displayName?: string };

export async function fetchTaskListOptions(): Promise<FieldOption[]> {
  const resp = await gwsJson<{ items?: ListResp }>(["tasks", "tasklists", "list"]);
  return (resp.items ?? []).map((t) => ({ value: t.id, label: t.title || t.id }));
}

export async function fetchCalendarOptions(): Promise<FieldOption[]> {
  const resp = await gwsJson<{ items?: CalItem[] }>(["calendar", "calendarList", "list"]);
  return (resp.items ?? []).map((c) => ({
    value: c.id,
    label: c.primary ? `${c.summary || c.id} (primary)` : c.summary || c.id,
  }));
}

export async function fetchChatSpaceOptions(): Promise<FieldOption[]> {
  const resp = await gwsJson<{ spaces?: SpaceItem[] }>(["chat", "spaces", "list"]);
  return (resp.spaces ?? []).map((s) => ({ value: s.name, label: s.displayName || s.name }));
}

/** Register every gws live-options provider. Called from gws/fetch.ts at app start. */
export function registerGwsFieldOptions(): void {
  registerFieldOptions(TASK_LISTS_KEY, fetchTaskListOptions);
  registerFieldOptions(CALENDARS_KEY, fetchCalendarOptions);
  registerFieldOptions(CHAT_SPACES_KEY, fetchChatSpaceOptions);
}
```

In `src/modules/gws/fetch.ts`, add the import and call at the end of the file:

```ts
import { registerGwsFieldOptions } from "./options";
// …existing registerFetch(...) calls…
registerGwsFieldOptions();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/gws-options.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/gws/options.ts src/modules/gws/fetch.ts tests/modules/gws-options.test.ts
git commit -m "feat: gws live-options providers (task lists, calendars, chat spaces)"
```

---

### Task 5: Opt the gws fields into live dropdowns

**Files:**
- Modify: `src/modules/gws/manifest.ts` (`calendarConfigSchema`, `tasksConfigSchema`, `nextMeetingConfigSchema`, `chatChannelsConfigSchema`)
- Test: `tests/modules/gws-options-schema.test.ts`

**Interfaces:**
- Consumes: `describeSchema` (Task 2); the `*_KEY` constants (Task 4).
- Produces: the four schemas now carry `optionsKey` on their ID field(s). Stored shapes and defaults unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/gws-options-schema.test.ts
import { describe, it, expect } from "vitest";
import { describeSchema } from "@/components/schema-form";
import {
  tasksConfigSchema, calendarConfigSchema, nextMeetingConfigSchema, chatChannelsConfigSchema,
} from "@/modules/gws/manifest";

const field = (schema: Parameters<typeof describeSchema>[0], key: string) =>
  describeSchema(schema).find((f) => f.key === key)!;

describe("gws config fields opt into live dropdowns", () => {
  it("tasklist is an asyncEnum bound to gws.taskLists", () => {
    expect(field(tasksConfigSchema, "tasklist")).toMatchObject({
      kind: "asyncEnum", optionsKey: "gws.taskLists", label: "Task list",
    });
  });
  it("calendarId (calendar + nextMeeting) is an asyncEnum bound to gws.calendars", () => {
    expect(field(calendarConfigSchema, "calendarId")).toMatchObject({
      kind: "asyncEnum", optionsKey: "gws.calendars",
    });
    expect(field(nextMeetingConfigSchema, "calendarId")).toMatchObject({
      kind: "asyncEnum", optionsKey: "gws.calendars",
    });
  });
  it("chat spaceIds is an asyncMultiEnum bound to gws.chatSpaces", () => {
    expect(field(chatChannelsConfigSchema, "spaceIds")).toMatchObject({
      kind: "asyncMultiEnum", optionsKey: "gws.chatSpaces",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/gws-options-schema.test.ts`
Expected: FAIL — fields are still `string` / `stringList` with no `optionsKey`.

- [ ] **Step 3: Write minimal implementation**

In `src/modules/gws/manifest.ts` add the import at the top:

```ts
import { TASK_LISTS_KEY, CALENDARS_KEY, CHAT_SPACES_KEY } from "./options";
```

Then edit the four fields (only the marked lines change):

```ts
// calendarConfigSchema
  calendarId: z.string().default("primary").meta({ optionsKey: CALENDARS_KEY }).describe("Calendar"),

// tasksConfigSchema
  tasklist: z.string().default("@default").meta({ optionsKey: TASK_LISTS_KEY }).describe("Task list"),

// nextMeetingConfigSchema
  calendarId: z.string().default("primary").meta({ optionsKey: CALENDARS_KEY }).describe("Calendar"),

// chatChannelsConfigSchema
  spaceIds: z.array(z.string()).default([]).meta({ optionsKey: CHAT_SPACES_KEY }).describe("Spaces"),
```

Note: `manifest.ts` importing from `options.ts` is safe — `options.ts` imports only `gwsJson` and the registry, no manifest cycle back into these symbols at module-eval time (the `*_KEY` are plain string consts).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/gws-options-schema.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/gws/manifest.ts tests/modules/gws-options-schema.test.ts
git commit -m "feat: gws task-list, calendar, and chat-space fields use live dropdowns"
```

---

### Task 6: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck + lint**

Run: `npm run lint`
Expected: no errors (a bare `npm run build:vite` may also be run to confirm the TS build).

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: PASS — 356 prior tests plus the new ones (field-options, schema-form async, gws-options, gws-options-schema); the existing `gws-registration` test still green (registry resolves every type; defaults unchanged).

- [ ] **Step 3: Manual smoke (documented, not automated)**

Run the app (`npm run dev`), open the Tasks widget's Configure dialog. Expected: "Task list" is a dropdown listing your Google task lists; Calendar / Next meeting show a Calendar dropdown; Chat Channels shows a space checklist (or, given the current 403 scope, falls back to the text editor). Saving stores the same id string(s) as before.

- [ ] **Step 4: Commit (if any lint autofixes)**

```bash
git add -A
git commit -m "chore: lint pass for async config options" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- Registry → Task 1. `describeSchema` kinds → Task 2. `SchemaForm` controls + fallbacks → Task 3. gws providers → Task 4. Schema opt-ins (tasks, calendar, nextMeeting, chatChannels) → Task 5. Tests across all. No stored-shape change / no cache bump → Global Constraints + Task 5. Error/scope fallback → Task 3 (text/StringListEditor fallback) + Task 6 smoke note.
- Gap check: none — every spec section maps to a task.

**Placeholder scan:** No TBD/TODO; every code step shows complete code and exact commands.

**Type consistency:** `FieldOption { value; label }` used identically in Tasks 1, 3, 4. `optionsKey` string threads Field (Task 2) → SchemaForm props (Task 3) → provider keys (Task 4) → schema `.meta` (Task 5). Provider fn names (`fetchTaskListOptions` etc.) and `*_KEY` consts match between Task 4 definition and Task 5 usage. CLI arg arrays match verified `gws` commands (`tasks tasklists list`, `calendar calendarList list`, `chat spaces list`).
