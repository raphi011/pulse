import { z } from "zod";
import { defineManifest } from "@/modules/contracts";

export const POMODORO_TYPE = "pomodoro.timer";

/** All fields render as number inputs in the auto-generated config form. */
export const pomodoroConfigSchema = z.object({
  workMinutes: z.number().int().min(1).max(180).default(25).describe("Work (minutes)"),
  shortBreakMinutes: z.number().int().min(1).max(60).default(5).describe("Short break (minutes)"),
  longBreakMinutes: z.number().int().min(1).max(60).default(15).describe("Long break (minutes)"),
  pomodorosPerLongBreak: z.number().int().min(1).max(12).default(4).describe("Pomodoros per long break"),
});
export type PomodoroConfig = z.infer<typeof pomodoroConfigSchema>;
export const pomodoroDefaultConfig: PomodoroConfig = {
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  pomodorosPerLongBreak: 4,
};

/**
 * Live widget: the cache pipeline carries no data — the card renders from the
 * engine singleton (src/modules/pomodoro/engine.ts), so fetch returns {}.
 */
export type PomodoroData = Record<string, never>;

export const pomodoroManifest = defineManifest({
  type: POMODORO_TYPE, title: "Pomodoro",
  configSchema: pomodoroConfigSchema, defaultConfig: pomodoroDefaultConfig,
  refreshable: false,
});
