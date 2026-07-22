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
      "https://lh3.googleusercontent.com/a/jane=s100",
    );
    expect(dm).toEqual({
      spaceId: "spaces/AAAA", partner: "Jane Doe", avatarUrl: "https://lh3.googleusercontent.com/a/jane=s100",
      snippet: "hi", time: "2026-07-10T10:00:00Z", url: "https://chat.google.com/dm/AAAA?cls=11",
    });
  });
  it("falls back to 'Direct message' and empty avatar when nothing resolved", () => {
    const dm = normalizeDm({ name: "spaces/AAAA" }, { name: "spaces/AAAA/messages/m1", sender: { name: "users/9" } }, null, null);
    expect(dm.partner).toBe("Direct message");
    expect(dm.avatarUrl).toBe("");
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
    if (args[0] === "people" && args[2] === "getBatchGet") {
      const people = opts.peopleByResource ?? {};
      const responses = (params.resourceNames as string[])
        .filter((rn) => rn in people)
        .map((rn) => ({ requestedResourceName: rn, person: people[rn] }));
      return Promise.resolve({ responses });
    }
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
        peopleByResource: {
          "people/2": { names: [{ displayName: "Bob" }], photos: [{ url: "https://silhouette", default: true }, { url: "https://bob=s100" }] },
        },
      }),
    );
    const { dms } = await fetchChatDms({ limit: 15 });
    expect(dms).toEqual([
      // avatarUrl skips the `default: true` silhouette in favour of the real photo
      { spaceId: "spaces/UNREAD", partner: "Bob", avatarUrl: "https://bob=s100", snippet: "hey", time: "2026-07-10T10:00:00Z", url: "https://chat.google.com/dm/UNREAD?cls=11" },
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

  it("resolves all partner names in a single People getBatchGet call (N+1 → 1)", async () => {
    const spaces = {
      spaces: [
        { name: "spaces/A", spaceUri: "u/A", lastActiveTime: "2026-07-10T10:00:00Z" },
        { name: "spaces/B", spaceUri: "u/B", lastActiveTime: "2026-07-10T09:00:00Z" },
      ],
    };
    mockJson.mockImplementation(
      router({
        spaces,
        readStateByName: {
          "users/me/spaces/A/spaceReadState": { name: "users/1/spaces/A/spaceReadState", lastReadTime: "2026-07-10T00:00:00Z" },
          "users/me/spaces/B/spaceReadState": { name: "users/1/spaces/B/spaceReadState", lastReadTime: "2026-07-10T00:00:00Z" },
        },
        msgByParent: {
          "spaces/A": { messages: [{ name: "spaces/A/messages/m", text: "a", createTime: "2026-07-10T10:00:00Z", sender: { name: "users/2" } }] },
          "spaces/B": { messages: [{ name: "spaces/B/messages/m", text: "b", createTime: "2026-07-10T09:00:00Z", sender: { name: "users/3" } }] },
        },
        peopleByResource: {
          "people/2": { names: [{ displayName: "Bob" }] },
          "people/3": { names: [{ displayName: "Cara" }] },
        },
      }),
    );
    const { dms } = await fetchChatDms({ limit: 15 });
    expect(dms.map((d) => d.partner)).toEqual(["Bob", "Cara"]);
    // Exactly one People call, and it carries both resource names.
    const peopleCalls = mockJson.mock.calls.filter((c) => c[0][0] === "people");
    expect(peopleCalls).toHaveLength(1);
    expect(peopleCalls[0][0]).toContain("getBatchGet");
    const params = JSON.parse(peopleCalls[0][0][peopleCalls[0][0].indexOf("--params") + 1]);
    expect(params.resourceNames).toEqual(["people/2", "people/3"]);
  });

  it("surfaces DMs whose latest-message fetch failed as errors, without dropping the rest silently", async () => {
    const spaces = {
      spaces: [
        { name: "spaces/OK", spaceUri: "u/OK", lastActiveTime: "2026-07-10T10:00:00Z" },
        { name: "spaces/BAD", spaceUri: "u/BAD", lastActiveTime: "2026-07-10T09:00:00Z" },
      ],
    };
    mockJson.mockImplementation((args: string[]) => {
      const params = JSON.parse(args[args.indexOf("--params") + 1]);
      if (args[2] === "list" && args[1] === "spaces") return Promise.resolve(spaces);
      if (args.includes("getSpaceReadState"))
        return Promise.resolve({ name: "users/1/x/spaceReadState", lastReadTime: "2026-07-10T00:00:00Z" });
      if (args[2] === "messages" && args[3] === "list") {
        if (params.parent === "spaces/BAD") return Promise.reject(new Error("boom"));
        return Promise.resolve({ messages: [{ name: "m", text: "ok", createTime: "2026-07-10T10:00:00Z", sender: { name: "users/2" } }] });
      }
      if (args[2] === "getBatchGet") return Promise.resolve({ responses: [{ requestedResourceName: "people/2", person: { names: [{ displayName: "Bob" }] } }] });
      throw new Error(`unexpected: ${args.join(" ")}`);
    });
    const res = await fetchChatDms({ limit: 15 });
    expect(res.dms.map((d) => d.spaceId)).toEqual(["spaces/OK"]);
    expect(res.errors).toEqual(["spaces/BAD"]);
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
    const { channels, errors } = await fetchChatChannels({ spaceIds: ["spaces/OK", "spaces/GONE"] });
    expect(channels).toEqual([
      { spaceId: "spaces/OK", name: "Ops", snippet: "deploy done", time: "2026-07-10T12:00:00Z", unread: true, url: "https://chat.google.com/room/OK?cls=11" },
    ]);
    // The dropped space is surfaced, not silently missing.
    expect(errors).toEqual(["spaces/GONE"]);
  });

  it("returns empty for empty config", async () => {
    expect(await fetchChatChannels({ spaceIds: [] })).toEqual({ channels: [] });
  });
});

import dmSpaces from "../fixtures/gws/chat/dm-spaces.json";
import readStateFixture from "../fixtures/gws/chat/space-read-state.json";
import messagesLatest from "../fixtures/gws/chat/messages-latest.json";
import peopleGet from "../fixtures/gws/chat/people-get.json";
import spaceGet from "../fixtures/gws/chat/space-get.json";

describe("fetchChatDms — against recorded fixtures (shape-drift guard)", () => {
  it("normalizes a real unread DM end-to-end", async () => {
    mockJson.mockImplementation(
      router({
        spaces: dmSpaces, // DM_AAA active 10:00 (unread below); DM_BBB active 2026-07-09 08:00 (read below)
        readStateByName: {
          "users/me/spaces/DM_AAA/spaceReadState": readStateFixture, // lastReadTime 2026-07-09T09:00 < 10:00 -> unread
          "users/me/spaces/DM_BBB/spaceReadState": { name: "users/100000000000000000001/spaces/DM_BBB/spaceReadState", lastReadTime: "2026-07-10T00:00:00Z" }, // read
        },
        msgByParent: { "spaces/DM_AAA": messagesLatest },
        peopleByResource: { "people/200000000000000000002": peopleGet },
      }),
    );
    const { dms } = await fetchChatDms({ limit: 15 });
    expect(dms).toEqual([
      {
        spaceId: "spaces/DM_AAA",
        partner: "Alex Rivera",
        avatarUrl: "https://lh3.googleusercontent.com/a/alex=s100",
        snippet: "hey, can you take a look at the PR when you get a chance?",
        time: "2026-07-10T10:00:00Z",
        url: "https://chat.google.com/dm/DM_AAA?cls=11",
      },
    ]);
  });
});

describe("fetchChatChannels — against recorded fixtures (shape-drift guard)", () => {
  it("normalizes a real configured space end-to-end", async () => {
    mockJson.mockImplementation(
      routeChannels(
        { "spaces/ROOM_CCC": spaceGet },
        { "users/me/spaces/ROOM_CCC/spaceReadState": readStateFixture }, // lastReadTime 2026-07-09T09:00 < space active 2026-07-10T12:00 -> unread
        { "spaces/ROOM_CCC": messagesLatest },
      ),
    );
    const { channels } = await fetchChatChannels({ spaceIds: ["spaces/ROOM_CCC"] });
    expect(channels).toEqual([
      {
        spaceId: "spaces/ROOM_CCC",
        name: "Team Ops",
        snippet: "hey, can you take a look at the PR when you get a chance?",
        time: "2026-07-10T10:00:00Z",
        unread: true,
        url: "https://chat.google.com/room/ROOM_CCC?cls=11",
      },
    ]);
  });
});
