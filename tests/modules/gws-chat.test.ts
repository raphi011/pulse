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

import { gwsJson } from "@/modules/gws/gws";
import { fetchChatDms } from "@/modules/gws/chat";
const mockJson = gwsJson as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => {
  mockJson.mockReset();
});

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
