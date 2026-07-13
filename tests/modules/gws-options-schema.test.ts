import { describe, it, expect } from "vitest";
import { describeSchema } from "@/components/schema-form";
import {
  tasksConfigSchema, calendarConfigSchema, nextMeetingConfigSchema, chatChannelsConfigSchema,
} from "@/modules/gws/manifest";

const field = (schema: Parameters<typeof describeSchema>[0], key: string) =>
  describeSchema(schema).find((f) => f.key === key)!;

describe("gws config fields opt into live dropdowns", () => {
  it("tasklist is an asyncEnum bound to gws.taskLists", () => {
    expect(field(tasksConfigSchema, "tasklist")).toMatchObject({
      kind: "asyncEnum", optionsKey: "gws.taskLists", label: "Task list",
    });
  });
  it("calendarId (calendar + nextMeeting) is an asyncEnum bound to gws.calendars", () => {
    expect(field(calendarConfigSchema, "calendarId")).toMatchObject({
      kind: "asyncEnum", optionsKey: "gws.calendars",
    });
    expect(field(nextMeetingConfigSchema, "calendarId")).toMatchObject({
      kind: "asyncEnum", optionsKey: "gws.calendars",
    });
  });
  it("chat spaceIds is an asyncMultiEnum bound to gws.chatSpaces", () => {
    expect(field(chatChannelsConfigSchema, "spaceIds")).toMatchObject({
      kind: "asyncMultiEnum", optionsKey: "gws.chatSpaces",
    });
  });
});
