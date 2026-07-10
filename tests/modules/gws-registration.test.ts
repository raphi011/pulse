import { describe, it, expect } from "vitest";
import "@/modules/fetch";
import "@/modules/render";
import { getFetchWidget } from "@/modules/fetch-registry";
import { getRenderWidget } from "@/modules/render-registry";
import { GMAIL_TYPE, CALENDAR_TYPE, CHAT_DMS_TYPE, CHAT_CHANNELS_TYPE, DRIVE_TYPE, TASKS_TYPE } from "@/modules/gws/manifest";

describe("gws registration barrels", () => {
  it("registers all gws widgets on both sides with defaults", () => {
    for (const t of [GMAIL_TYPE, CALENDAR_TYPE, CHAT_DMS_TYPE, CHAT_CHANNELS_TYPE, DRIVE_TYPE, TASKS_TYPE]) {
      expect(getFetchWidget(t), `server ${t}`).toBeDefined();
      expect(getRenderWidget(t), `client ${t}`).toBeDefined();
    }
    expect(getRenderWidget(GMAIL_TYPE)!.title).toBe("Gmail");
    expect(getRenderWidget(CALENDAR_TYPE)!.title).toBe("Calendar");
    expect(getRenderWidget(CHAT_DMS_TYPE)!.title).toBe("Unread DMs");
    expect(getRenderWidget(CHAT_CHANNELS_TYPE)!.title).toBe("Chat Channels");
    expect(getFetchWidget(GMAIL_TYPE)!.defaultConfig).toMatchObject({ query: "is:unread in:inbox", limit: 15 });
    expect(getFetchWidget(CALENDAR_TYPE)!.defaultConfig).toMatchObject({ calendarId: "primary", limit: 15 });
    expect(getFetchWidget(CHAT_DMS_TYPE)!.defaultConfig).toMatchObject({ limit: 15 });
    expect(getFetchWidget(CHAT_CHANNELS_TYPE)!.defaultConfig).toMatchObject({ spaceIds: [] });
    expect(getRenderWidget(DRIVE_TYPE)!.title).toBe("Starred files");
    expect(getFetchWidget(DRIVE_TYPE)!.defaultConfig).toMatchObject({
      showDocs: true, showSheets: true, showSlides: true, showOther: true, limit: 25,
    });
    expect(getRenderWidget(TASKS_TYPE)!.title).toBe("Tasks");
    expect(getFetchWidget(TASKS_TYPE)!.defaultConfig).toMatchObject({
      tasklist: "@default", showCompleted: false, limit: 25,
    });
  });
});
