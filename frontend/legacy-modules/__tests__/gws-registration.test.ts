import { describe, it, expect } from "vitest";
import "@/modules/fetch";
import "@/modules/render";
import { getFetchWidget } from "@/modules/fetch-registry";
import { getRenderWidget } from "@/modules/render-registry";
import { GMAIL_TYPE, CALENDAR_TYPE, CHAT_DMS_TYPE, CHAT_CHANNELS_TYPE, DRIVE_TYPE, TASKS_TYPE, NEXT_MEETING_TYPE } from "@/modules/gws/manifest";

describe("gws registration barrels", () => {
  it("registers all gws widgets on both sides with defaults", () => {
    for (const t of [GMAIL_TYPE, CALENDAR_TYPE, CHAT_DMS_TYPE, CHAT_CHANNELS_TYPE, DRIVE_TYPE, TASKS_TYPE, NEXT_MEETING_TYPE]) {
      expect(getFetchWidget(t), `server ${t}`).toBeDefined();
      expect(getRenderWidget(t), `client ${t}`).toBeDefined();
      expect(getFetchWidget(t)!.manifest).toBe(getRenderWidget(t)!.manifest);
    }
    expect(getRenderWidget(GMAIL_TYPE)!.manifest.title).toBe("Gmail");
    expect(getRenderWidget(CALENDAR_TYPE)!.manifest.title).toBe("Calendar");
    expect(getRenderWidget(CHAT_DMS_TYPE)!.manifest.title).toBe("Unread DMs");
    expect(getRenderWidget(CHAT_CHANNELS_TYPE)!.manifest.title).toBe("Chat Channels");
    expect(getFetchWidget(GMAIL_TYPE)!.manifest.defaultConfig).toMatchObject({ query: "is:unread in:inbox", limit: 15 });
    expect(getFetchWidget(CALENDAR_TYPE)!.manifest.defaultConfig).toMatchObject({ calendarId: "primary", limit: 15 });
    expect(getFetchWidget(CHAT_DMS_TYPE)!.manifest.defaultConfig).toMatchObject({ limit: 15 });
    expect(getFetchWidget(CHAT_CHANNELS_TYPE)!.manifest.defaultConfig).toMatchObject({ spaceIds: [] });
    expect(getRenderWidget(DRIVE_TYPE)!.manifest.title).toBe("Starred files");
    expect(getFetchWidget(DRIVE_TYPE)!.manifest.defaultConfig).toMatchObject({
      showDocs: true, showSheets: true, showSlides: true, showOther: true, limit: 25,
    });
    expect(getRenderWidget(TASKS_TYPE)!.manifest.title).toBe("Tasks");
    expect(getFetchWidget(TASKS_TYPE)!.manifest.defaultConfig).toMatchObject({
      tasklist: "@default", showCompleted: false, limit: 25,
    });
    expect(getRenderWidget(NEXT_MEETING_TYPE)!.manifest.title).toBe("Next meeting");
    expect(getFetchWidget(NEXT_MEETING_TYPE)!.manifest.defaultConfig).toMatchObject({
      calendarId: "primary", includeSoloEvents: false,
    });
  });
});
