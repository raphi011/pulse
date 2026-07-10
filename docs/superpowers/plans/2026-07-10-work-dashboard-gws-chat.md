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

## File Structure

- **New** `src/modules/gws/chat.ts` — server-only: pure helpers (`isUnread`, `callerUserId`,
  `spaceIdSegment`, `chatUrl`, `normalizeDm`, `normalizeChannel`) + orchestrators (`fetchChatDms`,
  `fetchChatChannels`), built on `gwsJson` from `./gws`.
- **New** `src/modules/gws/widgets/chat-dms-widget.tsx` — `"use client"` body.
- **New** `src/modules/gws/widgets/chat-channels-widget.tsx` — `"use client"` body.
- **New** `tests/fixtures/gws/chat/{dm-spaces,space-read-state,messages-latest,space-get}.json`.
- **New** `tests/modules/gws-chat.test.ts` — helper unit tests + mocked-`gwsJson` orchestration tests.
- **Modify** `src/modules/gws/manifest.ts` — add type ids, config schemas/defaults, data shapes.
- **Modify** `src/modules/gws/server.ts` — register the two server widgets.
- **Modify** `src/modules/gws/client.ts` — register the two client widgets.
- **Modify** `tests/modules/gws-registration.test.ts` — assert the two new types resolve on both sides.

No barrel edits: `gws/server.ts` and `gws/client.ts` are already imported by `src/modules/{server,client}.ts`.

---

### Task 0: Record real fixtures (auth prerequisite)

**Files:**
- Create: `tests/fixtures/gws/chat/dm-spaces.json`, `space-read-state.json`, `messages-latest.json`, `space-get.json`

- [ ] **Step 1: Confirm auth**

Run: `gws chat spaces list --params '{"pageSize":1}'`
Expected: JSON with a `spaces` array (not an `{ "error": { code: 401 } }` body). If 401, run `gws auth login` first.

- [ ] **Step 2: Record the four fixtures**

```bash
mkdir -p tests/fixtures/gws/chat
gws chat spaces list --params '{"filter":"spaceType = \"DIRECT_MESSAGE\"","pageSize":50}' > tests/fixtures/gws/chat/dm-spaces.json
# Pick one DM space name from the file above, e.g. spaces/AAAA:
gws chat users spaces getSpaceReadState --params '{"name":"users/me/spaces/AAAA/spaceReadState"}' > tests/fixtures/gws/chat/space-read-state.json
gws chat spaces messages list --params '{"parent":"spaces/AAAA","orderBy":"createTime desc","pageSize":1}' > tests/fixtures/gws/chat/messages-latest.json
gws chat spaces get --params '{"name":"spaces/AAAA"}' > tests/fixtures/gws/chat/space-get.json
```

- [ ] **Step 3: Verify the three provisional assumptions and record findings as comments in `chat.ts` later**

Confirm by inspecting the fixtures:
1. `messages-latest.json`: the message has `text`, `createTime`, and `sender.displayName` (non-empty for a human sender). If `sender.displayName` is empty, note it — Task 3's `normalizeDm` fallback ("Direct message") covers it, but flag for a possible `members.list` follow-up.
2. `space-read-state.json`: the `name` field is `users/<numeric-id>/spaces/.../spaceReadState` (not literally `users/me/...`). Either way `callerUserId` handles it.
3. Open the DM and a named space in a browser; note the URL fragment (`#chat/dm/<id>` vs `#chat/space/<id>`). If it differs from Task 2's `chatUrl`, adjust `chatUrl` accordingly.

- [ ] **Step 4: Commit the fixtures**

```bash
git add tests/fixtures/gws/chat/
git commit -m "test(gws): record Google Chat API fixtures"
```

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
  isUnread, callerUserId, spaceIdSegment, chatUrl, normalizeDm, normalizeChannel,
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

describe("spaceIdSegment / chatUrl", () => {
  it("strips the spaces/ prefix", () => expect(spaceIdSegment("spaces/AAAA")).toBe("AAAA"));
  it("builds a dm deep link", () =>
    expect(chatUrl("spaces/AAAA", "dm")).toBe("https://mail.google.com/chat/u/0/#chat/dm/AAAA"));
  it("builds a space deep link", () =>
    expect(chatUrl("spaces/AAAA", "space")).toBe("https://mail.google.com/chat/u/0/#chat/space/AAAA"));
});

describe("normalizeDm", () => {
  it("maps sender name, text, time, url", () => {
    const dm = normalizeDm(
      { name: "spaces/AAAA", lastActiveTime: "2026-07-10T10:00:00Z" },
      { name: "spaces/AAAA/messages/m1", text: "  hi  ", createTime: "2026-07-10T10:00:00Z", sender: { name: "users/9", displayName: "Jane Doe" } },
    );
    expect(dm).toEqual({
      spaceId: "spaces/AAAA", partner: "Jane Doe", snippet: "hi",
      time: "2026-07-10T10:00:00Z", url: "https://mail.google.com/chat/u/0/#chat/dm/AAAA",
    });
  });
  it("falls back to 'Direct message' when sender has no displayName", () => {
    const dm = normalizeDm({ name: "spaces/AAAA" }, { name: "spaces/AAAA/messages/m1", sender: { name: "users/9" } });
    expect(dm.partner).toBe("Direct message");
    expect(dm.snippet).toBe("");
  });
});

describe("normalizeChannel", () => {
  it("derives unread and prefers displayName", () => {
    const ch = normalizeChannel(
      "spaces/BBBB",
      { name: "spaces/BBBB", displayName: "Team Chat", lastActiveTime: "2026-07-10T12:00:00Z" },
      { lastReadTime: "2026-07-10T11:00:00Z" },
      { name: "spaces/BBBB/messages/m2", text: "ping", createTime: "2026-07-10T12:00:00Z" },
    );
    expect(ch).toEqual({
      spaceId: "spaces/BBBB", name: "Team Chat", snippet: "ping", time: "2026-07-10T12:00:00Z",
      unread: true, url: "https://mail.google.com/chat/u/0/#chat/space/BBBB",
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

// --- Raw gws Chat API shapes (only the fields we read) ---
type Space = { name: string; displayName?: string; spaceType?: string; lastActiveTime?: string };
type SpacesResp = { spaces?: Space[] };
type ReadState = { name?: string; lastReadTime?: string };
type ChatUser = { name?: string; displayName?: string; type?: string };
type Message = { name: string; text?: string; createTime?: string; sender?: ChatUser };
type MessagesResp = { messages?: Message[] };

/** "spaces/AAAA" -> "AAAA" (the id used in deep links). */
export function spaceIdSegment(spaceName: string): string {
  return spaceName.startsWith("spaces/") ? spaceName.slice("spaces/".length) : spaceName;
}

/** Google Chat web deep link. `kind` picks the DM vs space fragment (verified in Task 0). */
export function chatUrl(spaceName: string, kind: "space" | "dm"): string {
  return `https://mail.google.com/chat/u/0/#chat/${kind}/${spaceIdSegment(spaceName)}`;
}

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

export function normalizeDm(space: Space, msg: Message): ChatDm {
  return {
    spaceId: space.name,
    partner: msg.sender?.displayName?.trim() || "Direct message",
    snippet: msg.text?.trim() ?? "",
    time: msg.createTime ?? space.lastActiveTime ?? "",
    url: chatUrl(space.name, "dm"),
  };
}

export function normalizeChannel(spaceId: string, space: Space, rs: ReadState, msg?: Message): ChatChannel {
  return {
    spaceId,
    name: space.displayName?.trim() || spaceId,
    snippet: msg?.text?.trim() ?? "",
    time: msg?.createTime ?? space.lastActiveTime ?? "",
    unread: isUnread(space.lastActiveTime, rs.lastReadTime),
    url: chatUrl(spaceId, "space"),
  };
}
```

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

// args shape: ["chat", <resource...>, <method>, "--params", <json>]
function routeDms(spaces: unknown, readStateByParent: Record<string, unknown>, msgByParent: Record<string, unknown>) {
  return (args: string[]) => {
    const params = JSON.parse(args[args.indexOf("--params") + 1]);
    if (args[1] === "spaces" && args[2] === "list") return Promise.resolve(spaces);
    if (args.includes("getSpaceReadState")) return Promise.resolve(readStateByParent[params.name]);
    if (args[2] === "messages" && args[3] === "list") return Promise.resolve(msgByParent[params.parent]);
    throw new Error(`unexpected args: ${args.join(" ")}`);
  };
}

describe("fetchChatDms", () => {
  it("returns only unread DMs, sorted/capped, self-sent dropped", async () => {
    mockJson.mockImplementation(
      routeDms(
        {
          spaces: [
            { name: "spaces/UNREAD", lastActiveTime: "2026-07-10T10:00:00Z" },
            { name: "spaces/READ", lastActiveTime: "2026-07-10T08:00:00Z" },
            { name: "spaces/MINE", lastActiveTime: "2026-07-10T09:00:00Z" },
          ],
        },
        {
          "users/me/spaces/UNREAD/spaceReadState": { name: "users/1/spaces/UNREAD/spaceReadState", lastReadTime: "2026-07-10T09:00:00Z" },
          "users/me/spaces/READ/spaceReadState": { name: "users/1/spaces/READ/spaceReadState", lastReadTime: "2026-07-10T09:00:00Z" },
          "users/me/spaces/MINE/spaceReadState": { name: "users/1/spaces/MINE/spaceReadState", lastReadTime: "2026-07-10T08:00:00Z" },
        },
        {
          "spaces/UNREAD": { messages: [{ name: "spaces/UNREAD/messages/m", text: "hey", createTime: "2026-07-10T10:00:00Z", sender: { name: "users/2", displayName: "Bob" } }] },
          "spaces/MINE": { messages: [{ name: "spaces/MINE/messages/m", text: "mine", createTime: "2026-07-10T09:00:00Z", sender: { name: "users/1", displayName: "Me" } }] },
        },
      ),
    );
    const { dms } = await fetchChatDms({ limit: 15 });
    expect(dms).toEqual([
      { spaceId: "spaces/UNREAD", partner: "Bob", snippet: "hey", time: "2026-07-10T10:00:00Z", url: "https://mail.google.com/chat/u/0/#chat/dm/UNREAD" },
    ]);
  });

  it("caps the read-state scan at `limit` (most-recent first)", async () => {
    const spaces = { spaces: Array.from({ length: 5 }, (_, i) => ({ name: `spaces/S${i}`, lastActiveTime: `2026-07-10T1${i}:00:00Z` })) };
    const readState: Record<string, unknown> = {};
    mockJson.mockImplementation(routeDms(spaces, readState, {}));
    await fetchChatDms({ limit: 2 });
    const readStateCalls = mockJson.mock.calls.filter((c) => c[0].includes("getSpaceReadState"));
    expect(readStateCalls).toHaveLength(2);
    // The two most-recent (S4, S3) are the ones scanned.
    const scanned = readStateCalls.map((c) => JSON.parse(c[0][c[0].indexOf("--params") + 1]).name);
    expect(scanned).toEqual(["users/me/spaces/S4/spaceReadState", "users/me/spaces/S3/spaceReadState"]);
  });

  it("returns empty when nothing is unread", async () => {
    mockJson.mockImplementation(
      routeDms(
        { spaces: [{ name: "spaces/READ", lastActiveTime: "2026-07-10T08:00:00Z" }] },
        { "users/me/spaces/READ/spaceReadState": { name: "users/1/spaces/READ/spaceReadState", lastReadTime: "2026-07-10T09:00:00Z" } },
        {},
      ),
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

  // Latest message per unread candidate: supplies snippet, time, and partner name.
  const detailed = await Promise.allSettled(
    unread.map(({ space, me }) =>
      gwsJson<MessagesResp>([
        "chat", "spaces", "messages", "list",
        "--params", JSON.stringify({ parent: space.name, orderBy: "createTime desc", pageSize: 1 }),
      ]).then((resp) => ({ space, me, msg: resp.messages?.[0] })),
    ),
  );
  const dms = detailed
    .filter((r): r is PromiseFulfilledResult<{ space: Space; me: string | null; msg?: Message }> => r.status === "fulfilled")
    .filter((r) => !!r.value.msg)
    .filter(({ value: { msg, me } }) => !(me && msg!.sender?.name === me)) // drop self-sent
    .map(({ value: { space, msg } }) => normalizeDm(space, msg!));

  return { dms };
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
    if (args[1] === "spaces" && args[2] === "get") {
      const v = getByName[params.name];
      return v ? Promise.resolve(v) : Promise.reject(new Error("404"));
    }
    if (args.includes("getSpaceReadState")) return Promise.resolve(readByName[params.name]);
    if (args[2] === "messages" && args[3] === "list") return Promise.resolve(msgByParent[params.parent]);
    throw new Error(`unexpected: ${args.join(" ")}`);
  };
}

describe("fetchChatChannels", () => {
  it("enriches each configured space and flags unread; drops a 404 space", async () => {
    mockJson.mockImplementation(
      routeChannels(
        { "spaces/OK": { name: "spaces/OK", displayName: "Ops", lastActiveTime: "2026-07-10T12:00:00Z" } },
        {
          "users/me/spaces/OK/spaceReadState": { lastReadTime: "2026-07-10T11:00:00Z" },
          "users/me/spaces/GONE/spaceReadState": { lastReadTime: "2026-07-10T00:00:00Z" },
        },
        { "spaces/OK": { messages: [{ name: "spaces/OK/messages/m", text: "deploy done", createTime: "2026-07-10T12:00:00Z" }] } },
      ),
    );
    const { channels } = await fetchChatChannels({ spaceIds: ["spaces/OK", "spaces/GONE"] });
    expect(channels).toEqual([
      { spaceId: "spaces/OK", name: "Ops", snippet: "deploy done", time: "2026-07-10T12:00:00Z", unread: true, url: "https://mail.google.com/chat/u/0/#chat/space/OK" },
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
- Confirm the deep-link fragment matches what Task 0 Step 3 recorded; if not, fix `chatUrl` and re-run tests.

- [ ] **Step 3: Final commit if anything changed during verification**

```bash
git add -A && git commit -m "fix(gws): finalize Chat module against live output"
```

---

## Self-Review notes

- **Spec coverage:** Widget A funnel (Tasks 2–3), Widget B (Task 4), config schemas incl. `stringList` (Task 1), registrations (Tasks 5, 7), read/unread derivation + self-sent drop + caller-id parse (Tasks 2–3), error isolation via `Promise.allSettled` (Tasks 3–4), empty states (Task 6), fixtures + live verification (Tasks 0, 8). All spec sections map to a task.
- **Provisional shapes** (`sender.displayName`, read-state `name` id, deep-link fragment) are gated by Task 0 and re-checked in Task 8 — mirrors the Jira module's post-auth correction.
- **Type consistency:** `ChatDm`/`ChatChannel`/`*Config`/`*Data` and the `CHAT_DMS_TYPE`/`CHAT_CHANNELS_TYPE` ids are defined once in Task 1 and referenced verbatim thereafter; helper names (`isUnread`, `callerUserId`, `spaceIdSegment`, `chatUrl`, `normalizeDm`, `normalizeChannel`, `fetchChatDms`, `fetchChatChannels`) are consistent across tasks.
