import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/modules/gws/gws", () => ({ gwsJson: vi.fn() }));
import { gwsJson } from "@/modules/gws/gws";
import {
  fetchTaskListOptions, fetchCalendarOptions, fetchChatSpaceOptions,
} from "@/modules/gws/options";

const mockJson = gwsJson as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => mockJson.mockReset());

describe("gws option providers", () => {
  it("maps task lists to id/title options", async () => {
    mockJson.mockResolvedValue({ items: [
      { id: "MDYx", title: "Tasks" },
      { id: "ZDFr", title: "Other" },
    ] });
    await expect(fetchTaskListOptions()).resolves.toEqual([
      { value: "MDYx", label: "Tasks" },
      { value: "ZDFr", label: "Other" },
    ]);
    expect(mockJson).toHaveBeenCalledWith(["tasks", "tasklists", "list"]);
  });

  it("labels the primary calendar and maps the rest by summary", async () => {
    mockJson.mockResolvedValue({ items: [
      { id: "raphi@gmail.com", summary: "Personal", primary: true },
      { id: "fam@group", summary: "Family" },
    ] });
    await expect(fetchCalendarOptions()).resolves.toEqual([
      { value: "raphi@gmail.com", label: "Personal (primary)" },
      { value: "fam@group", label: "Family" },
    ]);
    expect(mockJson).toHaveBeenCalledWith(["calendar", "calendarList", "list"]);
  });

  it("maps chat spaces to name/displayName, falling back to the id", async () => {
    mockJson.mockResolvedValue({ spaces: [
      { name: "spaces/AAA", displayName: "Team" },
      { name: "spaces/BBB" },
    ] });
    await expect(fetchChatSpaceOptions()).resolves.toEqual([
      { value: "spaces/AAA", label: "Team" },
      { value: "spaces/BBB", label: "spaces/BBB" },
    ]);
    expect(mockJson).toHaveBeenCalledWith(["chat", "spaces", "list"]);
  });
});
