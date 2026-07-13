import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/modules/gws/gws", () => ({ gwsJson: vi.fn() }));
import { parseFrom, normalizeMessage, archiveEmail, markEmailRead, trashEmail } from "@/modules/gws/gmail";
import { gwsJson } from "@/modules/gws/gws";

const mockJson = gwsJson as unknown as ReturnType<typeof vi.fn>;

describe("parseFrom", () => {
  it("extracts the display name from a 'Name <email>' header", () => {
    expect(parseFrom("Jane Doe <jane@example.com>")).toBe("Jane Doe");
    expect(parseFrom('"Doe, Jane" <jane@example.com>')).toBe("Doe, Jane");
  });
  it("falls back to the bare address", () => {
    expect(parseFrom("jane@example.com")).toBe("jane@example.com");
  });
});

describe("normalizeMessage", () => {
  it("maps headers, unread label, date, and deep link", () => {
    const item = normalizeMessage({
      id: "abc123",
      labelIds: ["UNREAD", "INBOX"],
      internalDate: "1783656740000",
      payload: {
        headers: [
          { name: "Subject", value: "Hello" },
          { name: "From", value: "Jane <jane@example.com>" },
        ],
      },
    });
    expect(item).toMatchObject({
      id: "abc123",
      subject: "Hello",
      from: "Jane",
      unread: true,
      url: "https://mail.google.com/mail/u/0/#inbox/abc123",
    });
    expect(item.date).toBe(new Date(1783656740000).toISOString());
  });

  it("uses fallbacks when headers/labels are missing", () => {
    const item = normalizeMessage({ id: "x" });
    expect(item).toMatchObject({ subject: "(no subject)", from: "", unread: false, date: "" });
  });
});

describe("gmail mutations", () => {
  beforeEach(() => mockJson.mockReset());

  it("archiveEmail removes the INBOX label", async () => {
    mockJson.mockResolvedValue({});
    await archiveEmail("m1");
    const [args] = mockJson.mock.calls[0];
    expect(args.slice(0, 4)).toEqual(["gmail", "users", "messages", "modify"]);
    expect(args[4]).toBe("--params");
    expect(JSON.parse(args[5])).toEqual({ userId: "me", id: "m1" });
    expect(args[6]).toBe("--json");
    expect(JSON.parse(args[7])).toEqual({ removeLabelIds: ["INBOX"] });
  });

  it("markEmailRead removes the UNREAD label", async () => {
    mockJson.mockResolvedValue({});
    await markEmailRead("m2");
    const [args] = mockJson.mock.calls[0];
    expect(args.slice(0, 4)).toEqual(["gmail", "users", "messages", "modify"]);
    expect(JSON.parse(args[5])).toEqual({ userId: "me", id: "m2" });
    expect(JSON.parse(args[7])).toEqual({ removeLabelIds: ["UNREAD"] });
  });

  it("trashEmail calls the trash endpoint", async () => {
    mockJson.mockResolvedValue({});
    await trashEmail("m3");
    const [args] = mockJson.mock.calls[0];
    expect(args.slice(0, 4)).toEqual(["gmail", "users", "messages", "trash"]);
    expect(args[4]).toBe("--params");
    expect(JSON.parse(args[5])).toEqual({ userId: "me", id: "m3" });
    expect(args).toHaveLength(6); // no --json body for trash
  });
});
