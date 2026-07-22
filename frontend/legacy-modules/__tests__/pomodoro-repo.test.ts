import { describe, it, expect, beforeEach } from "vitest";
import { useTempDb } from "../helpers/db";
import { addSession, countSessionsToday } from "@/modules/pomodoro/repo";

beforeEach(() => useTempDb());

describe("pomodoro repo", () => {
  it("starts with zero sessions today", async () => {
    expect(await countSessionsToday()).toBe(0);
  });

  it("counts sessions finished today", async () => {
    await addSession(Date.now());
    await addSession(Date.now());
    expect(await countSessionsToday()).toBe(2);
  });

  it("excludes sessions finished before local midnight", async () => {
    const todayStart = new Date().setHours(0, 0, 0, 0);
    await addSession(todayStart - 1); // 1ms before midnight = yesterday
    await addSession(todayStart);
    await addSession(Date.now());
    expect(await countSessionsToday()).toBe(2);
  });

  it("counts relative to the passed `now`", async () => {
    const now = Date.now();
    await addSession(now);
    const tomorrow = now + 24 * 60 * 60 * 1000;
    expect(await countSessionsToday(tomorrow)).toBe(0);
  });
});
