# Design — Google Chat (extends the `gws` module)

**Date:** 2026-07-10
**Depends on:** the existing `gws` module (`src/modules/gws/`, Gmail + Calendar) — merged to `main`.
**Prev designs:** `2026-07-09-work-dashboard-design.md` (overall product),
`2026-07-10-work-dashboard-jira-module-design.md` (single-widget CLI-module precedent).

Adds Google Chat as **two new read-only widget types inside the existing `gws` module**, reusing
`gwsJson()` (`src/modules/gws/gws.ts`), the `gws` CLI, and its auth verbatim — the same way
`gws.gmail` and `gws.calendar` already coexist. No new module, CLI, dependency, or auth flow.

---

## Goals

- **`gws.chatDms` — Unread DMs.** Show direct messages that are unread (someone messaged you and you
  haven't read it), each as: partner name · latest-message snippet · time. Unread only.
- **`gws.chatChannels` — Configured channels.** For a user-configured list of spaces, show each
  space's latest message with a read/unread badge.
- Reuse the `gws` plumbing unchanged, proving it generalizes to a third Google service.

## Non-Goals (deliberately deferred)

- **Any write action** — no sending, marking read, or reacting. Read-only + link-out, matching every
  existing widget. (`+send` exists in the CLI; explicitly out of scope for now.)
- **A unified "all Chat activity" feed** across every space (heavy N+1; not requested).
- **Group-chat unread widget.** DMs + configured named spaces only. Group chats can fold into the
  channels widget later if wanted.
- Any change to the cache-first data flow, drag/reorder, refresh, config UI, or schema-form.

---

## ⚠️ Corrections after live verification (Task 0, 2026-07-10)

Recorded against the authenticated `gws` CLI. Two pre-auth assumptions were **wrong**; where the sections
below disagree, **these win** (fixtures in `tests/fixtures/gws/chat/`):

- **A message's `sender` is `{ name, type }` with NO `displayName`.** `members.list` also returns only
  user ids. So the partner name is **not** available from the Chat API. It is resolved via the **People
  API** (`gws people people get --params '{"resourceName":"people/<id>","personFields":"names"}'` →
  `names[0].displayName`), mapping the sender's `users/<id>` to `people/<id>` (same numeric id). This adds
  one People call per unread DM — cost returns to `1 + limit + (2 × unreadCount)`.
- **Deep links come from `Space.spaceUri`**, not a hand-built URL. Both DM spaces
  (`https://chat.google.com/dm/<id>?cls=11`) and named spaces (`https://chat.google.com/room/<id>?cls=11`)
  carry it in `spaces.list`/`spaces.get`. The `chatUrl`/`spaceIdSegment` helpers are dropped.
- **Confirmed:** the `getSpaceReadState` response `name` carries a numeric `users/<id>` (so `callerUserId`
  works), and named spaces do return `displayName` (so channels need no People call).

---

## Decisions (resolved during brainstorming)

- **Placement:** new widget types in the **existing `gws` module**, not a separate `chat` module —
  Chat is Google Workspace and shares the `gws` CLI + auth; a separate module would duplicate the
  `gwsJson` plumbing for no gain.
- **Data path:** the `gws` CLI's `chat` service via `gwsJson<T>(args)` (payload-model CLI,
  `runJsonCli`), identical to Gmail/Calendar.
- **Read/unread is derived, not read from a flag.** The Chat REST API exposes no per-message unread
  bit. Instead: `Space.lastActiveTime` (timestamp of the last message) vs the caller's `lastReadTime`
  from `users.spaces.getSpaceReadState`. `lastActiveTime > lastReadTime` ⇒ unread.
- **DM scan is a bounded funnel** (see below) — it does **not** fetch full detail for every DM.
- **Channel config = space resource IDs** (`spaces/AAAA…`), unambiguous. Users obtain them via
  `gws chat spaces list`; documented in the widget's empty/help copy. (Name-substring matching was
  considered and rejected: fuzzy, non-unique, and DMs have no display name.)

---

## API facts (verified against the installed `gws` CLI)

- `chat spaces list --params '{"filter":"spaceType = \"DIRECT_MESSAGE\""}'` → all DM spaces. The list
  response includes `lastActiveTime` (list strips only `permissionSettings`).
- `chat users spaces getSpaceReadState` → `{ name, lastReadTime }` for `users/me/spaces/<id>/spaceReadState`.
- `chat spaces messages list --params '{"parent":"spaces/<id>","orderBy":"createTime desc","pageSize":1}'`
  → latest message: `text`, `createTime`, and `sender` = `{ name: "users/<id>", type }` (**no
  `displayName`** — see corrections). For an unread DM the sender is the partner.
- `people people get --params '{"resourceName":"people/<id>","personFields":"names"}'` → `names[0].displayName`.
  Resolves a DM partner's user id (`users/<id>` → `people/<id>`) to a human name.
- `chat spaces get` → a named space's `displayName`, `spaceUri`, `lastActiveTime`.
- `Space.spaceUri` → the canonical deep link for both DMs and named spaces.
- The caller's own user id is recovered by parsing `users/<id>` out of the `getSpaceReadState` response
  `name` (`users/<id>/spaces/<space>/spaceReadState`) — used to drop self-sent last messages.

---

## Architecture

### Files — extend `src/modules/gws/`

```
manifest.ts               # ADD: type ids "gws.chatDms" / "gws.chatChannels",
                          #   Zod config schemas + defaults, ChatDm/ChatChannel data shapes.
chat.ts                   # NEW server-only: fetchChatDms(cfg) + fetchChatChannels(cfg),
                          #   built on the existing gwsJson<T>() from ./gws.
server.ts                 # ADD two registerServerWidget({...}) calls.
client.ts                 # ADD two registerClientWidget({...}) calls.
widgets/chat-dms-widget.tsx       # NEW "use client" body (WidgetBodyProps<ChatDmsData, ...>).
widgets/chat-channels-widget.tsx  # NEW "use client" body.
```

**Reused unchanged:** `gwsJson`/`runJsonCli`/`CliError`, the cache-first data flow, refresh
(manual/interval/post-config-save), the config UI + `schema-form`, the per-widget title override, and
every `WidgetShell` state. No barrel edits — `gws/server.ts` and `gws/client.ts` are already imported
by `src/modules/{server,client}.ts`.

### Widget A — `gws.chatDms` (Unread DMs): the bounded funnel

The key design point: **detail work is proportional to the number of *unread* DMs, not total DMs.**

1. **1 call** — `spaces list` filtered to `DIRECT_MESSAGE`. Yields every DM *with* `lastActiveTime`.
2. Sort by `lastActiveTime` desc, keep the top **`limit`** (config). Old, quiet DMs are effectively
   always read; skipping them past `limit` is safe and bounds the scan.
3. For those ≤ `limit` DMs — `getSpaceReadState` each (`Promise.allSettled`; 1 light call per DM).
   Unread candidate ⇔ `lastActiveTime > lastReadTime`. The response `name` also yields the caller's own
   user id (parsed once).
4. **Only for the actually-unread few** — fetch the latest message (`Promise.allSettled`) for the snippet
   (`text`), time (`createTime`), and partner id (`sender.name`). Drop it if `sender` is the caller
   (self-sent). Then resolve the partner id → name via the **People API**. `url` comes from the DM's
   `spaceUri`.

Cost ≈ `1 + limit + (2 × unreadCount)`. Since most DMs are read, the step-4 message + People fetches fire
only for the handful genuinely unread.

- **Unread definition:** `lastActiveTime > lastReadTime`. If the last message's `sender` resolves to
  the caller, drop it (you don't need to "read" your own send) — belt-and-suspenders on top of read
  state, which normally already advances when you post.
- **Config** (`ChatDmsConfig = { limit: number }`):
  ```ts
  const chatDmsConfigSchema = z.object({
    limit: z.number().int().min(1).max(50).default(15)
      .describe("Max recent DMs to scan"),
  });
  const chatDmsDefaultConfig: ChatDmsConfig = { limit: 15 };
  ```
- **Normalized shape:**
  ```ts
  type ChatDm = {
    spaceId: string;          // "spaces/AAAA"
    partner: string;          // People-API-resolved name (fallback: "Direct message")
    snippet: string;          // latest message text, trimmed
    time: string;             // ISO createTime of latest message
    url: string;              // Space.spaceUri
  };
  type ChatDmsData = { dms: ChatDm[] };   // unread only
  ```

### Widget B — `gws.chatChannels` (Configured channels)

- **Config** (`ChatChannelsConfig = { spaceIds: string[] }`) — `z.array(z.string())` renders as the
  `stringList` field kind (auto-form supported):
  ```ts
  const chatChannelsConfigSchema = z.object({
    spaceIds: z.array(z.string()).default([])
      .describe("Space IDs (spaces/…) — run `gws chat spaces list`"),
  });
  const chatChannelsDefaultConfig: ChatChannelsConfig = { spaceIds: [] };
  ```
- **fetch:** per configured space (`Promise.allSettled`): `spaces get` (displayName + lastActiveTime)
  + `getSpaceReadState` + latest message (`orderBy=createTime desc`, `pageSize=1`). Unread ⇔
  `lastActiveTime > lastReadTime`.
- **Normalized shape:**
  ```ts
  type ChatChannel = {
    spaceId: string;
    name: string;             // displayName
    snippet: string;          // latest message text
    time: string;             // ISO createTime
    unread: boolean;
    url: string;              // Space.spaceUri
  };
  type ChatChannelsData = { channels: ChatChannel[] };  // all configured, unread-badged
  ```
- **Row rendering:** channel name · latest snippet · relative time · unread dot/badge. Row links to
  `url`. Empty config → `WidgetShell` "empty" state with the "run `gws chat spaces list`" hint.

### Data flow (unchanged, reused)

Widget mounts → `GET /api/widgets/:id/data` returns the cached row instantly → refresh (manual,
interval, or post-config-save) re-runs `fetch()` → writes `widget_cache` → returns fresh.
`getWidgetData` keeps the last-good payload on error; the UI shows a "stale" badge.

## Error handling

- **API/auth failures** flow through `gwsJson` → `runJsonCli`, which maps embedded `401/403` to
  `kind:"auth"` ("Not authenticated — run `gws auth login`") and other embedded errors to
  `kind:"failed"`; `widget-service` keeps last-good and surfaces the message. All already wired.
- **Per-item failures** (one DM's readState or message, one channel) are isolated by `Promise.allSettled`
  — one bad item doesn't sink the widget (mirrors `github/prs.ts` and `gws/gmail.ts`).
- **Bad/stale space ID** in channel config → that space's `spaces get` 404s → dropped from results;
  the rest still render.
- **No unread DMs / empty channel config** → existing `WidgetShell` "empty" state.

## Testing (TDD)

No network in tests. Sanitized fixtures live under `tests/fixtures/gws/chat/` (`dm-spaces.json`,
`space-read-state.json`, `messages-latest.json`, `space-get.json`, `people-get.json`) — recorded from
real output in Task 0, then names/message text replaced with placeholders.

1. **`fetchChatDms()`** — mock `gwsJson` to return fixtures; assert: the funnel filters to unread only
   (`lastActiveTime > lastReadTime`), read DMs are excluded, a DM whose latest message sender is the
   caller is excluded, `partner` = People-API-resolved name with the "Direct message" fallback, `url`
   comes from `spaceUri`, `limit` bounds the read-state scan, and the no-unread-DMs case → `{ dms: [] }`.
2. **`fetchChatChannels()`** — assert per-space enrichment, `unread` flag derivation, a 404 space ID is
   dropped while others survive, and empty config → `{ channels: [] }`.
3. **Registration test** — `tests/modules/gws-registration.test.ts` (extend if present, else add):
   both new types resolve in the server *and* client registries (per-module convention).

`cli.ts`, the config PATCH, and `schema-form` introspection are already covered and need no new tests.

## Verification (definition of done)

- `npm run lint`, `tsc --noEmit`, `npm test` clean; `npm run build` succeeds.
- Prereq: `gws auth login` done.
- Live: add an **Unread DMs** widget → shows current unread DMs (or the correct auth/error/empty
  state); reading a DM in Google Chat then refreshing drops it from the list. Add a **Chat Channels**
  widget, configure it with a space ID from `gws chat spaces list` → shows that channel's latest
  message with a correct read/unread badge; config + title persist across reload; clicking a row opens
  the space in Google Chat.

## Files touched

- **New:** `src/modules/gws/chat.ts`; `src/modules/gws/widgets/chat-dms-widget.tsx`;
  `src/modules/gws/widgets/chat-channels-widget.tsx`; `tests/fixtures/gws/chat/*.json`;
  chat fetch tests (+ registration-test additions).
- **Edited:** `src/modules/gws/manifest.ts`, `src/modules/gws/server.ts`,
  `src/modules/gws/client.ts` (module-internal wiring only).
