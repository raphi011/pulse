import { describe, it, expect } from "vitest";
import { parseFrom, normalizeMessage } from "@/modules/gws/gmail";

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
