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
