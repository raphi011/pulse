# Google Chat (gws) Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two read-only Google Chat widgets — **Unread DMs** (`gws.chatDms`) and **Configured channels** (`gws.chatChannels`) — to the existing `gws` module.

**Architecture:** Extend `src/modules/gws/`. Read/unread is *derived* (`Space.lastActiveTime` vs the caller's `getSpaceReadState.lastReadTime`) since the Chat API has no unread flag. Unread DMs use a bounded funnel: one `spaces.list` call → sort by `lastActiveTime`, cap at `limit` → per-DM read-state check → fetch the latest message only for the actually-unread few (that message supplies snippet + time + partner name via `sender.displayName`). All data flows through the existing `gwsJson()` wrapper; the cache-first framework, refresh, config UI, and title override are reused unchanged.

**Tech Stack:** Next.js + TypeScript, the `gws` CLI (`chat` service), Zod config schemas, Vitest (`vi.mock` on the CLI wrapper), Tailwind v4 widget bodies.

**Spec:** `docs/superpowers/specs/2026-07-10-work-dashboard-gws-chat-design.md`

---

## ⚠️ Reality-check gate (read before Task 1)

The Jira module's spec assumptions were **wrong pre-auth** (see its "Corrections after live verification"
section). The same risk applies here: the raw Chat API shapes below (`sender.displayName` population, the
`getSpaceReadState.name` numeric id, the browser deep-link format) are **provisional until Task 0 records
real authenticated output**. Task 0 is mandatory and gates every later task's field access.

## ✅ Task 0 findings (already recorded — these override the code sketches below where they differ)

Task 0 ran against live auth. Fixtures are committed under `tests/fixtures/gws/chat/`. Three corrections:

1. **A message's `sender` is `{ name: "users/<id>", type }` — NO `displayName`.** `members.list` also
   returns only ids. The partner name is resolved via the **People API**:
   `gws people people get --params '{"resourceName":"people/<id>","personFields":"names"}'` →
   `names[0].displayName`, mapping `users/<id>` → `people/<id>`.
2. **Deep links come from `Space.spaceUri`** (`https://chat.google.com/dm/<id>?cls=11` for DMs,
   `.../room/<id>?cls=11` for named spaces) — present in `spaces.list` and `spaces.get`. No URL building;
   the `chatUrl`/`spaceIdSegment` helpers are **dropped**.
3. Confirmed: `getSpaceReadState.name` is `users/<numeric-id>/...` (so `callerUserId` works) and named
   spaces return `displayName` (channels need no People call).

## File Structure

- **New** `src/modules/gws/chat.ts` — server-only: pure helpers (`isUnread`, `callerUserId`,
  `peopleResourceName`, `normalizeDm`, `normalizeChannel`) + orchestrators (`fetchChatDms`,
  `fetchChatChannels`), built on `gwsJson` from `./gws`.
- **New** `src/modules/gws/widgets/chat-dms-widget.tsx` — `"use client"` body.
- **New** `src/modules/gws/widgets/chat-channels-widget.tsx` — `"use client"` body.
- **New** `tests/fixtures/gws/chat/{dm-spaces,space-read-state,messages-latest,space-get,people-get}.json` (done in Task 0).
- **New** `tests/modules/gws-chat.test.ts` — helper unit tests + mocked-`gwsJson` orchestration tests.
- **Modify** `src/modules/gws/manifest.ts` — add type ids, config schemas/defaults, data shapes.
- **Modify** `src/modules/gws/server.ts` — register the two server widgets.
- **Modify** `src/modules/gws/client.ts` — register the two client widgets.
- **Modify** `tests/modules/gws-registration.test.ts` — assert the two new types resolve on both sides.

No barrel edits: `gws/server.ts` and `gws/client.ts` are already imported by `src/modules/{server,client}.ts`.

---

### Task 0: Record + sanitize fixtures — ✅ DONE

Recorded live, sanitized (real names/message text replaced with placeholders), and committed:
`tests/fixtures/gws/chat/{dm-spaces,space-read-state,messages-latest,space-get,people-get}.json`.
Findings are captured in the "Task 0 findings" callout above and folded into the tasks below. No action
remains here.

---

### Task 1: Manifest — types, config schemas, data shapes

**Files:**
- Modify: `src/modules/gws/manifest.ts`

- [ ] **Step 1: Append to `manifest.ts`** (after the existing calendar block)

```ts
export const CHAT_DMS_TYPE = "gws.chatDms";
export const CHAT_CHANNELS_TYPE = "gws.chatChannels";

export const chatDmsConfigSchema = z.object({
  limit: z.number().int().min(1).max(50).default(15).describe("Max recent DMs to scan"),
});
export type ChatDmsConfig = z.infer<typeof chatDmsConfigSchema>;
export const chatDmsDefaultConfig: ChatDmsConfig = { limit: 15 };

export const chatChannelsConfigSchema = z.object({
  spaceIds: z
    .array(z.string())
    .default([])
    .describe("Space IDs (spaces/…) — run `gws chat spaces list`"),
});
export type ChatChannelsConfig = z.infer<typeof chatChannelsConfigSchema>;
export const chatChannelsDefaultConfig: ChatChannelsConfig = { spaceIds: [] };

export type ChatDm = {
  spaceId: string; // "spaces/AAAA"
  partner: string; // latest message sender.displayName (fallback "Direct message")
  snippet: string; // latest message text, trimmed
  time: string;    // ISO createTime of latest message
  url: string;     // Google Chat deep link
};
export type ChatDmsData = { dms: ChatDm[] };

export type ChatChannel = {
  spaceId: string;
  name: string;    // space displayName (fallback: the id)
  snippet: string;
  time: string;
  unread: boolean;
  url: string;
};
export type ChatChannelsData = { channels: ChatChannel[] };
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/gws/manifest.ts
git commit -m "feat(gws): add Chat widget config schemas and data shapes"
```

---

### Task 2: `chat.ts` pure helpers (TDD)

**Files:**
- Create: `src/modules/gws/chat.ts`
- Test: `tests/modules/gws-chat.test.ts`

- [ ] **Step 1: Write the failing helper tests**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/modules/gws/gws", () => ({ gwsJson: vi.fn() }));
import {
  isUnread, callerUserId, peopleResourceName, normalizeDm, normalizeChannel,
} from "@/modules/gws/chat";

describe("isUnread", () => {
  it("true when last message is newer than last read", () =>
    expect(isUnread("2026-07-10T10:00:00Z", "2026-07-10T09:00:00Z")).toBe(true));
  it("false when last read is at/after last message", () =>
    expect(isUnread("2026-07-10T09:00:00Z", "2026-07-10T09:00:00Z")).toBe(false));
  it("false when there are no messages", () =>
    expect(isUnread(undefined, "2026-07-10T09:00:00Z")).toBe(false));
  it("true when never read but messages exist", () =>
    expect(isUnread("2026-07-10T10:00:00Z", undefined)).toBe(true));
});

describe("callerUserId", () => {
  it("extracts users/<id> from a read-state name", () =>
    expect(callerUserId("users/12345/spaces/AAAA/spaceReadState")).toBe("users/12345"));
  it("returns null when absent", () => expect(callerUserId(undefined)).toBeNull());
});

describe("peopleResourceName", () => {
  it("maps users/<id> to people/<id>", () =>
    expect(peopleResourceName("users/9")).toBe("people/9"));
  it("returns null when missing", () => expect(peopleResourceName(undefined)).toBeNull());
});

describe("normalizeDm", () => {
  it("maps partner name, text, time, url (from spaceUri)", () => {
    const dm = normalizeDm(
      { name: "spaces/AAAA", spaceUri: "https://chat.google.com/dm/AAAA?cls=11", lastActiveTime: "2026-07-10T10:00:00Z" },
      { name: "spaces/AAAA/messages/m1", text: "  hi  ", createTime: "2026-07-10T10:00:00Z", sender: { name: "users/9" } },
      "Jane Doe",
    );
    expect(dm).toEqual({
      spaceId: "spaces/AAAA", partner: "Jane Doe", snippet: "hi",
      time: "2026-07-10T10:00:00Z", url: "https://chat.google.com/dm/AAAA?cls=11",
    });
  });
  it("falls back to 'Direct message' when no name resolved", () => {
    const dm = normalizeDm({ name: "spaces/AAAA" }, { name: "spaces/AAAA/messages/m1", sender: { name: "users/9" } }, null);
    expect(dm.partner).toBe("Direct message");
    expect(dm.snippet).toBe("");
    expect(dm.url).toBe("");
  });
});

describe("normalizeChannel", () => {
  it("derives unread, prefers displayName, url from spaceUri", () => {
    const ch = normalizeChannel(
      "spaces/BBBB",
      { name: "spaces/BBBB", displayName: "Team Chat", spaceUri: "https://chat.google.com/room/BBBB?cls=11", lastActiveTime: "2026-07-10T12:00:00Z" },
      { lastReadTime: "2026-07-10T11:00:00Z" },
      { name: "spaces/BBBB/messages/m2", text: "ping", createTime: "2026-07-10T12:00:00Z" },
    );
    expect(ch).toEqual({
      spaceId: "spaces/BBBB", name: "Team Chat", snippet: "ping", time: "2026-07-10T12:00:00Z",
      unread: true, url: "https://chat.google.com/room/BBBB?cls=11",
    });
  });
  it("falls back to the id when no displayName", () => {
    const ch = normalizeChannel("spaces/BBBB", { name: "spaces/BBBB" }, {}, undefined);
    expect(ch.name).toBe("spaces/BBBB");
    expect(ch.unread).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- gws-chat`
Expected: FAIL — `chat.ts` doesn't export these yet.

- [ ] **Step 3: Write `chat.ts` (helpers + raw shapes)**

```ts
import "server-only";
import { gwsJson } from "./gws";
import type {
  ChatDmsConfig, ChatDmsData, ChatChannelsConfig, ChatChannelsData, ChatDm, ChatChannel,
} from "./manifest";

// --- Raw gws Chat/People API shapes (only the fields we read; see Task 0 fixtures) ---
type Space = { name: string; displayName?: string; spaceType?: string; spaceUri?: string; lastActiveTime?: string };
type SpacesResp = { spaces?: Space[] };
type ReadState = { name?: string; lastReadTime?: string };
type ChatUser = { name?: string; type?: string }; // NOTE: Chat's sender/member has NO displayName
type Message = { name: string; text?: string; createTime?: string; sender?: ChatUser };
type MessagesResp = { messages?: Message[] };
type Person = { names?: { displayName?: string }[] };

/** A space is unread when its last message is newer than the caller's last read time. */
export function isUnread(lastActiveTime?: string, lastReadTime?: string): boolean {
  if (!lastActiveTime) return false; // no messages yet
  if (!lastReadTime) return true;    // never read
  return new Date(lastActiveTime).getTime() > new Date(lastReadTime).getTime();
}

/** "users/12345/spaces/AAAA/spaceReadState" -> "users/12345" (or null). */
export function callerUserId(readStateName?: string): string | null {
  const m = readStateName?.match(/^(users\/[^/]+)\//);
  return m ? m[1] : null;
}

/** Chat sender id "users/12345" -> People API resource "people/12345" (or null). */
export function peopleResourceName(userName?: string): string | null {
  const m = userName?.match(/^users\/(.+)$/);
  return m ? `people/${m[1]}` : null;
}

export function normalizeDm(space: Space, msg: Message, partner: string | null): ChatDm {
  return {
    spaceId: space.name,
    partner: partner?.trim() || "Direct message",
    snippet: msg.text?.trim() ?? "",
    time: msg.createTime ?? space.lastActiveTime ?? "",
    url: space.spaceUri ?? "",
  };
}

export function normalizeChannel(spaceId: string, space: Space, rs: ReadState, msg?: Message): ChatChannel {
  return {
    spaceId,
    name: space.displayName?.trim() || spaceId,
    snippet: msg?.text?.trim() ?? "",
    time: msg?.createTime ?? space.lastActiveTime ?? "",
    unread: isUnread(space.lastActiveTime, rs.lastReadTime),
    url: space.spaceUri ?? "",
  };
}
```

The `Person` type is used by `fetchChatDms` (Task 3) for the People-API name lookup.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- gws-chat`
Expected: PASS (helper describes green; orchestration tests come in Tasks 3–4).

- [ ] **Step 5: Commit**

```bash
git add src/modules/gws/chat.ts tests/modules/gws-chat.test.ts
git commit -m "feat(gws): add Chat helper functions"
```

---

### Task 3: `fetchChatDms` — the bounded funnel (TDD)

**Files:**
- Modify: `src/modules/gws/chat.ts`
- Test: `tests/modules/gws-chat.test.ts`

- [ ] **Step 1: Add the failing orchestration test**

Append to `tests/modules/gws-chat.test.ts`. The mock routes by the gws sub-command so one mock serves the whole funnel:

```ts
import { gwsJson } from "@/modules/gws/gws";
import { fetchChatDms } from "@/modules/gws/chat";
const mockJson = gwsJson as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => mockJson.mockReset());

// Routes a gws call by its sub-command. args shape: [<service>, <resource...>, <method>, "--params", <json>]
function router(opts: {
  spaces: unknown;
  readStateByName: Record<string, unknown>;
  msgByParent: Record<string, unknown>;
  peopleByResource?: Record<string, unknown>;
}) {
  return (args: string[]) => {
    const params = JSON.parse(args[args.indexOf("--params") + 1]);
    if (args[0] === "chat" && args[1] === "spaces" && args[2] === "list") return Promise.resolve(opts.spaces);
    if (args.includes("getSpaceReadState")) return Promise.resolve(opts.readStateByName[params.name]);
    if (args[0] === "chat" && args[2] === "messages" && args[3] === "list") return Promise.resolve(opts.msgByParent[params.parent]);
    if (args[0] === "people" && args[2] === "get") return Promise.resolve((opts.peopleByResource ?? {})[params.resourceName]);
    throw new Error(`unexpected args: ${args.join(" ")}`);
  };
}

describe("fetchChatDms", () => {
  it("returns only unread DMs (sorted/capped), drops self-sent, resolves name via People API, url from spaceUri", async () => {
    mockJson.mockImplementation(
      router({
        spaces: {
          spaces: [
            { name: "spaces/UNREAD", spaceUri: "https://chat.google.com/dm/UNREAD?cls=11", lastActiveTime: "2026-07-10T10:00:00Z" },
            { name: "spaces/READ", spaceUri: "https://chat.google.com/dm/READ?cls=11", lastActiveTime: "2026-07-10T08:00:00Z" },
            { name: "spaces/MINE", spaceUri: "https://chat.google.com/dm/MINE?cls=11", lastActiveTime: "2026-07-10T09:00:00Z" },
          ],
        },
        readStateByName: {
          "users/me/spaces/UNREAD/spaceReadState": { name: "users/1/spaces/UNREAD/spaceReadState", lastReadTime: "2026-07-10T09:00:00Z" },
          "users/me/spaces/READ/spaceReadState": { name: "users/1/spaces/READ/spaceReadState", lastReadTime: "2026-07-10T09:00:00Z" },
          "users/me/spaces/MINE/spaceReadState": { name: "users/1/spaces/MINE/spaceReadState", lastReadTime: "2026-07-10T08:00:00Z" },
        },
        msgByParent: {
          "spaces/UNREAD": { messages: [{ name: "spaces/UNREAD/messages/m", text: "hey", createTime: "2026-07-10T10:00:00Z", sender: { name: "users/2", type: "HUMAN" } }] },
          "spaces/MINE": { messages: [{ name: "spaces/MINE/messages/m", text: "mine", createTime: "2026-07-10T09:00:00Z", sender: { name: "users/1", type: "HUMAN" } }] },
        },
        peopleByResource: { "people/2": { names: [{ displayName: "Bob" }] } },
      }),
    );
    const { dms } = await fetchChatDms({ limit: 15 });
    expect(dms).toEqual([
      { spaceId: "spaces/UNREAD", partner: "Bob", snippet: "hey", time: "2026-07-10T10:00:00Z", url: "https://chat.google.com/dm/UNREAD?cls=11" },
    ]);
  });

  it("caps the read-state scan at `limit` (most-recent first)", async () => {
    const spaces = { spaces: Array.from({ length: 5 }, (_, i) => ({ name: `spaces/S${i}`, lastActiveTime: `2026-07-10T1${i}:00:00Z` })) };
    // All read (lastReadTime after lastActiveTime) so no message/People calls fire.
    const readStateByName: Record<string, unknown> = {};
    for (let i = 0; i < 5; i++)
      readStateByName[`users/me/spaces/S${i}/spaceReadState`] = { name: `users/1/spaces/S${i}/spaceReadState`, lastReadTime: "2026-07-11T00:00:00Z" };
    mockJson.mockImplementation(router({ spaces, readStateByName, msgByParent: {} }));
    await fetchChatDms({ limit: 2 });
    const readStateCalls = mockJson.mock.calls.filter((c) => c[0].includes("getSpaceReadState"));
    expect(readStateCalls).toHaveLength(2);
    const scanned = readStateCalls.map((c) => JSON.parse(c[0][c[0].indexOf("--params") + 1]).name);
    expect(scanned).toEqual(["users/me/spaces/S4/spaceReadState", "users/me/spaces/S3/spaceReadState"]);
  });

  it("returns empty when nothing is unread", async () => {
    mockJson.mockImplementation(
      router({
        spaces: { spaces: [{ name: "spaces/READ", lastActiveTime: "2026-07-10T08:00:00Z" }] },
        readStateByName: { "users/me/spaces/READ/spaceReadState": { name: "users/1/spaces/READ/spaceReadState", lastReadTime: "2026-07-10T09:00:00Z" } },
        msgByParent: {},
      }),
    );
    expect(await fetchChatDms({ limit: 15 })).toEqual({ dms: [] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- gws-chat`
Expected: FAIL — `fetchChatDms` not exported.

- [ ] **Step 3: Implement `fetchChatDms` in `chat.ts`**

```ts
export async function fetchChatDms(config: ChatDmsConfig): Promise<ChatDmsData> {
  const list = await gwsJson<SpacesResp>([
    "chat", "spaces", "list",
    "--params", JSON.stringify({ filter: 'spaceType = "DIRECT_MESSAGE"', pageSize: 1000 }),
  ]);
  const dmSpaces = (list.spaces ?? [])
    .filter((s) => s.lastActiveTime) // no messages -> nothing to be unread
    .sort((a, b) => new Date(b.lastActiveTime!).getTime() - new Date(a.lastActiveTime!).getTime())
    .slice(0, config.limit);

  // Read state per candidate (light). One failure shouldn't sink the widget.
  const readStates = await Promise.allSettled(
    dmSpaces.map((space) =>
      gwsJson<ReadState>([
        "chat", "users", "spaces", "getSpaceReadState",
        "--params", JSON.stringify({ name: `users/me/${space.name}/spaceReadState` }),
      ]).then((rs) => ({ space, rs })),
    ),
  );
  const unread = readStates
    .filter((r): r is PromiseFulfilledResult<{ space: Space; rs: ReadState }> => r.status === "fulfilled")
    .filter(({ space, rs }) => isUnread(space.lastActiveTime, rs.lastReadTime))
    .map(({ space, rs }) => ({ space, me: callerUserId(rs.name) }));

  // For each unread DM: latest message (snippet/time/partner id), then resolve the name via People API.
  const settled = await Promise.allSettled(
    unread.map(async ({ space, me }) => {
      const resp = await gwsJson<MessagesResp>([
        "chat", "spaces", "messages", "list",
        "--params", JSON.stringify({ parent: space.name, orderBy: "createTime desc", pageSize: 1 }),
      ]);
      const msg = resp.messages?.[0];
      if (!msg) return null;
      if (me && msg.sender?.name === me) return null; // self-sent — not an unread-from-partner
      const partner = await resolvePartnerName(msg.sender?.name);
      return normalizeDm(space, msg, partner);
    }),
  );
  const dms = settled
    .filter((r): r is PromiseFulfilledResult<ChatDm | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((d): d is ChatDm => d !== null);

  return { dms };
}

/** Resolve a Chat sender id ("users/<id>") to a display name via the People API, or null on failure. */
async function resolvePartnerName(userName?: string): Promise<string | null> {
  const resourceName = peopleResourceName(userName);
  if (!resourceName) return null;
  try {
    const person = await gwsJson<Person>([
      "people", "people", "get",
      "--params", JSON.stringify({ resourceName, personFields: "names" }),
    ]);
    return person.names?.[0]?.displayName ?? null;
  } catch {
    return null; // name lookup failed — normalizeDm falls back to "Direct message"
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- gws-chat`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/gws/chat.ts tests/modules/gws-chat.test.ts
git commit -m "feat(gws): add fetchChatDms unread-DM funnel"
```

---

### Task 4: `fetchChatChannels` (TDD)

**Files:**
- Modify: `src/modules/gws/chat.ts`
- Test: `tests/modules/gws-chat.test.ts`

- [ ] **Step 1: Add the failing test**

```ts
import { fetchChatChannels } from "@/modules/gws/chat";

function routeChannels(getByName: Record<string, unknown>, readByName: Record<string, unknown>, msgByParent: Record<string, unknown>) {
  return (args: string[]) => {
    const params = JSON.parse(args[args.indexOf("--params") + 1]);
    if (args[0] === "chat" && args[1] === "spaces" && args[2] === "get") {
      const v = getByName[params.name];
      return v ? Promise.resolve(v) : Promise.reject(new Error("404"));
    }
    if (args.includes("getSpaceReadState")) return Promise.resolve(readByName[params.name]);
    if (args[0] === "chat" && args[2] === "messages" && args[3] === "list") return Promise.resolve(msgByParent[params.parent]);
    throw new Error(`unexpected: ${args.join(" ")}`);
  };
}

describe("fetchChatChannels", () => {
  it("enriches each configured space and flags unread; drops a 404 space", async () => {
    mockJson.mockImplementation(
      routeChannels(
        { "spaces/OK": { name: "spaces/OK", displayName: "Ops", spaceUri: "https://chat.google.com/room/OK?cls=11", lastActiveTime: "2026-07-10T12:00:00Z" } },
        {
          "users/me/spaces/OK/spaceReadState": { lastReadTime: "2026-07-10T11:00:00Z" },
          "users/me/spaces/GONE/spaceReadState": { lastReadTime: "2026-07-10T00:00:00Z" },
        },
        { "spaces/OK": { messages: [{ name: "spaces/OK/messages/m", text: "deploy done", createTime: "2026-07-10T12:00:00Z" }] } },
      ),
    );
    const { channels } = await fetchChatChannels({ spaceIds: ["spaces/OK", "spaces/GONE"] });
    expect(channels).toEqual([
      { spaceId: "spaces/OK", name: "Ops", snippet: "deploy done", time: "2026-07-10T12:00:00Z", unread: true, url: "https://chat.google.com/room/OK?cls=11" },
    ]);
  });

  it("returns empty for empty config", async () => {
    expect(await fetchChatChannels({ spaceIds: [] })).toEqual({ channels: [] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- gws-chat`
Expected: FAIL — `fetchChatChannels` not exported.

- [ ] **Step 3: Implement `fetchChatChannels` in `chat.ts`**

```ts
export async function fetchChatChannels(config: ChatChannelsConfig): Promise<ChatChannelsData> {
  const results = await Promise.allSettled(
    config.spaceIds.map(async (spaceId) => {
      // Any one of these rejecting (e.g. a stale/404 id) drops just this space.
      const [space, rs, msgs] = await Promise.all([
        gwsJson<Space>(["chat", "spaces", "get", "--params", JSON.stringify({ name: spaceId })]),
        gwsJson<ReadState>([
          "chat", "users", "spaces", "getSpaceReadState",
          "--params", JSON.stringify({ name: `users/me/${spaceId}/spaceReadState` }),
        ]),
        gwsJson<MessagesResp>([
          "chat", "spaces", "messages", "list",
          "--params", JSON.stringify({ parent: spaceId, orderBy: "createTime desc", pageSize: 1 }),
        ]),
      ]);
      return normalizeChannel(spaceId, space, rs, msgs.messages?.[0]);
    }),
  );
  const channels = results
    .filter((r): r is PromiseFulfilledResult<ChatChannel> => r.status === "fulfilled")
    .map((r) => r.value);
  return { channels };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- gws-chat`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/gws/chat.ts tests/modules/gws-chat.test.ts
git commit -m "feat(gws): add fetchChatChannels"
```

---

### Task 5: Register server widgets

**Files:**
- Modify: `src/modules/gws/server.ts`

- [ ] **Step 1: Extend `server.ts`**

Add imports and two `registerServerWidget` calls, mirroring the existing gmail/calendar registrations:

```ts
import {
  GMAIL_TYPE, CALENDAR_TYPE, CHAT_DMS_TYPE, CHAT_CHANNELS_TYPE,
  gmailConfigSchema, gmailDefaultConfig,
  calendarConfigSchema, calendarDefaultConfig,
  chatDmsConfigSchema, chatDmsDefaultConfig,
  chatChannelsConfigSchema, chatChannelsDefaultConfig,
} from "./manifest";
import { fetchGmail } from "./gmail";
import { fetchCalendar } from "./calendar";
import { fetchChatDms, fetchChatChannels } from "./chat";

// ...existing gmail + calendar registrations unchanged...

registerServerWidget({
  type: CHAT_DMS_TYPE, configSchema: chatDmsConfigSchema, defaultConfig: chatDmsDefaultConfig, fetch: fetchChatDms,
});
registerServerWidget({
  type: CHAT_CHANNELS_TYPE, configSchema: chatChannelsConfigSchema, defaultConfig: chatChannelsDefaultConfig, fetch: fetchChatChannels,
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/gws/server.ts
git commit -m "feat(gws): register Chat server widgets"
```

---

### Task 6: Widget bodies

**Files:**
- Create: `src/modules/gws/widgets/chat-dms-widget.tsx`, `src/modules/gws/widgets/chat-channels-widget.tsx`

- [ ] **Step 1: Write `chat-dms-widget.tsx`** (mirrors `gmail-widget.tsx`'s `shortDate` + list styling)

```tsx
"use client";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { ChatDmsData, ChatDmsConfig } from "../manifest";

function shortDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function ChatDmsWidget({ data }: WidgetBodyProps<ChatDmsData, ChatDmsConfig>) {
  if (data.dms.length === 0)
    return <p className="text-sm text-slate-500 dark:text-slate-400">No unread DMs.</p>;
  return (
    <ul className="divide-y divide-border dark:divide-border-dark">
      {data.dms.map((dm) => (
        <li key={dm.spaceId} className="flex items-center gap-2.5 py-2">
          <span aria-label="unread" className="h-2 w-2 shrink-0 rounded-full bg-primary-500" />
          <a href={dm.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 hover:underline">
            <span className="block truncate text-sm font-semibold">{dm.partner}</span>
            <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{dm.snippet}</span>
          </a>
          <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">{shortDate(dm.time)}</span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Write `chat-channels-widget.tsx`**

```tsx
"use client";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { ChatChannelsData, ChatChannelsConfig } from "../manifest";

function shortDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function ChatChannelsWidget({ data }: WidgetBodyProps<ChatChannelsData, ChatChannelsConfig>) {
  if (data.channels.length === 0)
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        No channels configured — add space IDs (run <code>gws chat spaces list</code>).
      </p>
    );
  return (
    <ul className="divide-y divide-border dark:divide-border-dark">
      {data.channels.map((c) => (
        <li key={c.spaceId} className="flex items-center gap-2.5 py-2">
          <span
            aria-label={c.unread ? "unread" : "read"}
            className={`h-2 w-2 shrink-0 rounded-full ${c.unread ? "bg-primary-500" : "bg-transparent"}`}
          />
          <a href={c.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 hover:underline">
            <span className={`block truncate text-sm ${c.unread ? "font-semibold" : ""}`}>{c.name}</span>
            <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{c.snippet}</span>
          </a>
          <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">{shortDate(c.time)}</span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/gws/widgets/chat-dms-widget.tsx src/modules/gws/widgets/chat-channels-widget.tsx
git commit -m "feat(gws): add Chat widget bodies"
```

---

### Task 7: Register client widgets + registration test

**Files:**
- Modify: `src/modules/gws/client.ts`, `tests/modules/gws-registration.test.ts`

- [ ] **Step 1: Update the failing registration test first**

```ts
import { GMAIL_TYPE, CALENDAR_TYPE, CHAT_DMS_TYPE, CHAT_CHANNELS_TYPE } from "@/modules/gws/manifest";

describe("gws registration barrels", () => {
  it("registers all gws widgets on both sides with defaults", () => {
    for (const t of [GMAIL_TYPE, CALENDAR_TYPE, CHAT_DMS_TYPE, CHAT_CHANNELS_TYPE]) {
      expect(getServerWidget(t), `server ${t}`).toBeDefined();
      expect(getClientWidget(t), `client ${t}`).toBeDefined();
    }
    expect(getClientWidget(CHAT_DMS_TYPE)!.title).toBe("Unread DMs");
    expect(getClientWidget(CHAT_CHANNELS_TYPE)!.title).toBe("Chat Channels");
    expect(getServerWidget(CHAT_DMS_TYPE)!.defaultConfig).toMatchObject({ limit: 15 });
    expect(getServerWidget(CHAT_CHANNELS_TYPE)!.defaultConfig).toMatchObject({ spaceIds: [] });
  });
});
```

(Keep the existing gmail/calendar title/default assertions — extend, don't replace them.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- gws-registration`
Expected: FAIL — chat types not registered on the client.

- [ ] **Step 3: Extend `client.ts`**

```ts
import {
  GMAIL_TYPE, CALENDAR_TYPE, CHAT_DMS_TYPE, CHAT_CHANNELS_TYPE,
  gmailConfigSchema, gmailDefaultConfig,
  calendarConfigSchema, calendarDefaultConfig,
  chatDmsConfigSchema, chatDmsDefaultConfig,
  chatChannelsConfigSchema, chatChannelsDefaultConfig,
} from "./manifest";
import { GmailWidget } from "./widgets/gmail-widget";
import { CalendarWidget } from "./widgets/calendar-widget";
import { ChatDmsWidget } from "./widgets/chat-dms-widget";
import { ChatChannelsWidget } from "./widgets/chat-channels-widget";

// ...existing gmail + calendar registrations unchanged...

registerClientWidget({
  type: CHAT_DMS_TYPE, title: "Unread DMs", Component: ChatDmsWidget,
  configSchema: chatDmsConfigSchema, defaultConfig: chatDmsDefaultConfig,
});
registerClientWidget({
  type: CHAT_CHANNELS_TYPE, title: "Chat Channels", Component: ChatChannelsWidget,
  configSchema: chatChannelsConfigSchema, defaultConfig: chatChannelsDefaultConfig,
});
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- gws-registration`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/gws/client.ts tests/modules/gws-registration.test.ts
git commit -m "feat(gws): register Chat client widgets"
```

---

### Task 8: Full verification (definition of done)

- [ ] **Step 1: Run the whole suite + lint + build**

Run: `npm test && npm run lint && npx tsc --noEmit && npm run build`
Expected: all green.

- [ ] **Step 2: Live check (prereq: `gws auth login`)**

Run: `npm run dev`, then in the browser:
- Add an **Unread DMs** widget → shows current unread DMs (or the auth/error/empty state). Read a DM in Google Chat, refresh the widget → it drops off the list.
- Add a **Chat Channels** widget → configure it via ⋯ Configure with a space ID from `gws chat spaces list` → shows that channel's latest message with a correct read/unread badge; config + title persist across reload; clicking a row opens the space in Google Chat.
- Confirm rows link through correctly (the `spaceUri` from the API) and DM partner names resolve (People API).

- [ ] **Step 3: Final commit if anything changed during verification**

```bash
git add -A && git commit -m "fix(gws): finalize Chat module against live output"
```

---

## Self-Review notes

- **Spec coverage:** Widget A funnel (Tasks 2–3), Widget B (Task 4), config schemas incl. `stringList` (Task 1), registrations (Tasks 5, 7), read/unread derivation + self-sent drop + caller-id parse (Tasks 2–3), error isolation via `Promise.allSettled` (Tasks 3–4), empty states (Task 6), fixtures + live verification (Tasks 0, 8). All spec sections map to a task.
- **Live-verified shapes:** Task 0 already corrected the pre-auth guesses — `sender` has no `displayName` (names via People API), links come from `spaceUri`, read-state `name` carries a numeric id. Folded into Tasks 2–3.
- **Type consistency:** `ChatDm`/`ChatChannel`/`*Config`/`*Data` and the `CHAT_DMS_TYPE`/`CHAT_CHANNELS_TYPE` ids are defined once in Task 1 and referenced verbatim thereafter; helper names (`isUnread`, `callerUserId`, `peopleResourceName`, `normalizeDm`, `normalizeChannel`, `fetchChatDms`, `fetchChatChannels`, plus internal `resolvePartnerName`) are consistent across tasks.
