import { describe, it, expect } from "vitest";
import "@/modules/server";
import "@/modules/client";
import { getServerWidget } from "@/modules/server-registry";
import { getClientWidget } from "@/modules/client-registry";
import { GMAIL_TYPE, CALENDAR_TYPE } from "@/modules/gws/manifest";

describe("gws registration barrels", () => {
  it("registers gmail and calendar on both sides with defaults", () => {
    for (const t of [GMAIL_TYPE, CALENDAR_TYPE]) {
      expect(getServerWidget(t), `server ${t}`).toBeDefined();
      expect(getClientWidget(t), `client ${t}`).toBeDefined();
    }
    expect(getClientWidget(GMAIL_TYPE)!.title).toBe("Gmail");
    expect(getClientWidget(CALENDAR_TYPE)!.title).toBe("Calendar");
    expect(getServerWidget(GMAIL_TYPE)!.defaultConfig).toMatchObject({ query: "is:unread in:inbox", limit: 15 });
    expect(getServerWidget(CALENDAR_TYPE)!.defaultConfig).toMatchObject({ calendarId: "primary", limit: 15 });
  });
});
