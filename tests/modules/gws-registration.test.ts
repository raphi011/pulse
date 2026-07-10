import { describe, it, expect } from "vitest";
import "@/modules/server";
import "@/modules/client";
import { getServerWidget } from "@/modules/server-registry";
import { getClientWidget } from "@/modules/client-registry";
import { GMAIL_TYPE, CALENDAR_TYPE, CHAT_DMS_TYPE, CHAT_CHANNELS_TYPE, DRIVE_TYPE } from "@/modules/gws/manifest";

describe("gws registration barrels", () => {
  it("registers all gws widgets on both sides with defaults", () => {
    for (const t of [GMAIL_TYPE, CALENDAR_TYPE, CHAT_DMS_TYPE, CHAT_CHANNELS_TYPE, DRIVE_TYPE]) {
      expect(getServerWidget(t), `server ${t}`).toBeDefined();
      expect(getClientWidget(t), `client ${t}`).toBeDefined();
    }
    expect(getClientWidget(GMAIL_TYPE)!.title).toBe("Gmail");
    expect(getClientWidget(CALENDAR_TYPE)!.title).toBe("Calendar");
    expect(getClientWidget(CHAT_DMS_TYPE)!.title).toBe("Unread DMs");
    expect(getClientWidget(CHAT_CHANNELS_TYPE)!.title).toBe("Chat Channels");
    expect(getServerWidget(GMAIL_TYPE)!.defaultConfig).toMatchObject({ query: "is:unread in:inbox", limit: 15 });
    expect(getServerWidget(CALENDAR_TYPE)!.defaultConfig).toMatchObject({ calendarId: "primary", limit: 15 });
    expect(getServerWidget(CHAT_DMS_TYPE)!.defaultConfig).toMatchObject({ limit: 15 });
    expect(getServerWidget(CHAT_CHANNELS_TYPE)!.defaultConfig).toMatchObject({ spaceIds: [] });
    expect(getClientWidget(DRIVE_TYPE)!.title).toBe("Starred files");
    expect(getServerWidget(DRIVE_TYPE)!.defaultConfig).toMatchObject({
      showDocs: true, showSheets: true, showSlides: true, showOther: true, limit: 25,
    });
  });
});
