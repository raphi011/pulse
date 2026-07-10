# Integrations Layer — Design

**Date:** 2026-07-10
**Status:** Approved (pending spec review)

## Problem

The dashboard has no notion of an *integration* — a tool-level unit distinct from
a code-organization module. Users cannot see, per tool:

- Is the necessary CLI installed?
- Is it authenticated?
- Is it enabled or disabled?

There is also no gate on the add-widget list (every registered widget shows,
regardless of whether its tool is usable), and no per-widget signal when
something is wrong (auth expired, broken query, tool missing).

## Goals

1. A first-class **integration** abstraction at the *tool* level, decoupled from
   modules. Modules stay pure code-organization units; a module's widget types
   declare which integration they belong to.
2. A dedicated `/integrations` UI showing each integration's install / auth /
   enabled status, with install and auth instructions when unhealthy.
3. Only widgets from **enabled** integrations appear in the add-widget list.
4. A warning "!" indicator on any widget with an active issue; hovering explains
   what is wrong.

## Non-goals

- Interval-based health polling (probe on demand only).
- A settings framework beyond this one page.
- Restoring widgets after an integration is disabled (disable deletes them).

## Key decisions (from brainstorming)

- **Integration ≠ module.** They coincide 1:1 today, but install/auth/enabled are
  properties of the *tool*, not of a code-org unit. A dedicated registry (mirroring
  the existing server/client registries) makes "tool-level" true in code and avoids
  the shared-tool trap and the `core`/`system` "tool-less integration" special case.
  Reinforced by upcoming tool-less modules (e.g. local CPU/mem usage).
- **Enabled is a computed default with an override.** `enabled = override ?? (!tool || installed)`.
  No-tool integrations and installed tools default on; missing tools default off.
  Installing a tool later auto-flips an untouched integration on.
- **Auth is orthogonal to enabled.** An installed-but-unauthenticated tool stays
  enabled (its widgets remain addable and on the dashboard); it only warns. Auth
  tokens expire — losing auth must never disable panels.
- **Disable deletes active widgets** (destructive, after explicit confirmation).
  Re-enabling does not restore them.
- **Two status sources:** the `/integrations` panel uses a live probe (must report
  even for integrations with no widgets); the per-widget "!" reads the widget's last
  cached fetch result (no double-probing).

## Architecture

### Integration contract + registry (new)

```ts
// src/modules/integration-contracts.ts
export interface IntegrationHealth {
  installed: boolean;
  authed: boolean | "n/a"; // "n/a" when the tool has no auth (core, system/cpu-mem)
  detail?: string;         // human-readable message when unhealthy
}

export interface Integration {
  id: string;   // "github" | "jira" | "gws" | "core" | "system"
  name: string; // "GitHub"
  tool?: {
    bin: string;         // "gh"
    installHint: string; // how to install (plain text incl. the command)
    authHint: string;    // how to authenticate
  };
  checkHealth(): Promise<IntegrationHealth>;
}
```

- No `enabledByDefault` field — the default is derived from health.
- `src/modules/integration-registry.ts` — server-only, mirrors `server-registry.ts`
  (`registerIntegration` / `getIntegration` / `listIntegrations` / `__clearIntegrationRegistry`).
- `src/modules/integrations.ts` — barrel that imports each module's integration
  registration (mirrors `server.ts` / `client.ts`).

### Widget type → integration association

Add an optional `integration?: string` to both `ServerWidget` and `ClientWidget`
in `contracts.ts`. Each widget registration names its integration id:

- `github.*` → `"github"`, `gws.*` → `"gws"`, `jira.jql` → `"jira"`.
- `core.status` → no integration (always available).

### Enabled state

- Stored in `prefs` as `integration.<id>.enabled`, **tri-state**:
  unset → follow computed default; `"true"` / `"false"` → explicit override.
- Resolver (server): `enabled = override ?? (!integration.tool || health.installed)`.

### Health probing + caching

- `checkHealth()` per integration:
  - **install** — binary presence (`ENOENT` from `execFile`, or a cheap `--version`).
  - **auth** — a light per-tool probe the integration defines (`gh auth status`,
    `jira me`, a `gws` no-op). No-tool integrations report `installed:true, authed:"n/a"`.
- In-memory cache (~30s TTL) in the integration server module. `/integrations`
  probes on open; a **Re-check** button bypasses the cache. No interval, no probe
  on page load.

### Error-kind propagation (for the "!")

- `widget_cache` gains an `error_kind` column (`text`, nullable) — Drizzle migration.
- `widget-service` stores `CliError.kind` on failure (`auth` / `not-found` /
  `timeout` / `failed`); non-`CliError` → `failed`.
- Remediation *text* already comes free: the CLI wrappers set messages like
  *"Not authenticated — run `gh auth login`"*. Kind only drives icon semantics.

## UI

### `/integrations` route

- App Router page; server component probes all integrations and renders one row per
  integration: **name · installed? · authenticated? · enabled toggle**.
- Unhealthy rows expand to show `installHint` / `authHint`.
- Toggling **off** an integration that has active widgets of its types →
  confirmation dialog stating the exact count, then **deletes** those widgets and
  sets the override to `false`. Wording is explicit that this is permanent, e.g.
  *"This permanently removes 3 Jira widgets from your dashboard."*
- Toggling **on** simply sets the override to `"true"`.
- **Re-check** button re-runs probes (bypasses the 30s cache).
- Shell header gains a plug/gear link to the page.

### Add-widget list

- The drawer fetches integration status (TanStack Query) and shows only widget
  types whose integration is **enabled**. Widgets with no integration (`core`) always
  show. Missing-tool integrations are off by default, so they don't appear until
  installed (or force-enabled).

### Widget "!" indicator

- A warning triangle in the `WidgetShell` **header**, shown whenever the widget's
  last cached fetch was `status:error` (whether or not stale cached data exists).
- Hover tooltip = the cached `error` message (already includes the fix).
- Kind drives styling (`auth` / `not-found` / `failed` → amber triangle).
- **Replaces the current "stale" pill** with a clearer, uniform indicator. The
  in-body error state (shown when there is no cached data to fall back to) stays.

## Data flow

1. `/integrations` (server) → for each integration: resolve override from `prefs`,
   run cached `checkHealth()`, compute `enabled` → render rows.
2. Toggle action (server) → writes `prefs` override; on disable-with-widgets,
   deletes matching widget rows first.
3. Add-widget drawer (client) → GET integration status → filter client widget list
   by `enabled`.
4. Widget fetch (existing) → `widget-service` caches `status` + `error` + `error_kind`
   → `widget-card` renders the "!" from the cached row.

## Components / files

**New**
- `src/modules/integration-contracts.ts` — `Integration`, `IntegrationHealth`.
- `src/modules/integration-registry.ts` — server-only registry.
- `src/modules/integrations.ts` — barrel import of module integration registrations.
- One integration declaration per module: `github`, `jira`, `gws`, `core`, plus a
  minimal `system` integration (seed for a future cpu/mem module).
- `/integrations` page + a status API route + a toggle server action/route.
- Integration status hook for the client (TanStack Query).

**Changed**
- `contracts.ts` — add `integration?: string` to `ServerWidget` / `ClientWidget`.
- Each module's `server.ts` / `client.ts` — pass `integration` on registration.
- `db/schema.ts` + migration — `error_kind` column on `widget_cache`.
- `server/cache-repo.ts` — persist / read `errorKind`.
- `server/widget-service.ts` — capture `CliError.kind`.
- `components/add-widget-drawer.tsx` — filter by enabled integrations.
- `components/widget-shell.tsx` / `components/widget-card.tsx` — "!" indicator,
  drop the "stale" pill.
- Shell header — link to `/integrations`.

## Testing

- Integration registry: register / resolve / duplicate-throws (mirrors existing
  registry tests).
- Enabled resolver: override precedence and computed default across
  `{tool?, installed}` combinations.
- `checkHealth()` classification per tool (installed/authed/failed) with mocked
  `runCli`.
- Error-kind propagation: `widget-service` maps each `CliError.kind` into the cache.
- Add-widget filtering: only enabled integrations' widgets listed.
- Disable-with-active-widgets: confirmation path deletes the right widget rows.
- Per-module registration test asserts the integration id resolves (extend the
  existing `tests/modules/*-registration.test.ts`).

## Open risks

- The `system` integration is a seed only; the cpu/mem module itself is out of scope.
- Health-probe commands per tool need verifying against the installed CLI versions
  (`jira me` / `gws` no-op exact invocation) during implementation.
