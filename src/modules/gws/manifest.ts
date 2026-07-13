import { z } from "zod";
import { defineManifest } from "@/modules/contracts";
import { TASK_LISTS_KEY, CALENDARS_KEY, CHAT_SPACES_KEY } from "./option-keys";

export const GMAIL_TYPE = "gws.gmail";
export const CALENDAR_TYPE = "gws.calendar";

// --- Config schemas (.describe() drives form labels) ---
export const gmailConfigSchema = z.object({
  query: z.string().default("is:unread in:inbox").describe("Gmail search query"),
  limit: z.number().int().min(1).max(50).default(15).describe("Max emails"),
});
export type GmailConfig = z.infer<typeof gmailConfigSchema>;
export const gmailDefaultConfig: GmailConfig = { query: "is:unread in:inbox", limit: 15 };

export const calendarConfigSchema = z.object({
  calendarId: z.string().default("primary").meta({ optionsKey: CALENDARS_KEY }).describe("Calendar"),
  limit: z.number().int().min(1).max(50).default(15).describe("Max events"),
});
export type CalendarConfig = z.infer<typeof calendarConfigSchema>;
export const calendarDefaultConfig: CalendarConfig = { calendarId: "primary", limit: 15 };

// --- Data shapes ---
export type EmailItem = {
  id: string;
  subject: string;
  from: string; // display name, falling back to the raw From header
  date: string; // ISO timestamp ("" if unknown)
  unread: boolean;
  url: string; // Gmail deep link
};
export type GmailData = { emails: EmailItem[] };

export type CalendarEventItem = {
  id: string;
  title: string;
  start: string; // ISO datetime, or YYYY-MM-DD for all-day
  end: string;
  allDay: boolean;
  location?: string;
  meetUrl?: string;
  url: string; // htmlLink
};
export type CalendarData = { events: CalendarEventItem[] };

export const CHAT_DMS_TYPE = "gws.chatDms";
export const CHAT_CHANNELS_TYPE = "gws.chatChannels";

export const chatDmsConfigSchema = z.object({
  limit: z.number().int().min(1).max(50).default(15).describe("Max recent DMs to scan"),
});
export type ChatDmsConfig = z.infer<typeof chatDmsConfigSchema>;
export const chatDmsDefaultConfig: ChatDmsConfig = { limit: 15 };

export const chatChannelsConfigSchema = z.object({
  spaceIds: z
    .array(z.string())
    .default([])
    .meta({ optionsKey: CHAT_SPACES_KEY })
    .describe("Spaces"),
});
export type ChatChannelsConfig = z.infer<typeof chatChannelsConfigSchema>;
export const chatChannelsDefaultConfig: ChatChannelsConfig = { spaceIds: [] };

export type ChatDm = {
  spaceId: string; // "spaces/AAAA"
  partner: string; // People-API-resolved name (fallback "Direct message")
  avatarUrl: string; // People API photo url ("" when missing or a default silhouette)
  snippet: string; // latest message text, trimmed
  time: string;    // ISO createTime of latest message
  url: string;     // Space.spaceUri
};
export type ChatDmsData = { dms: ChatDm[] };

export type ChatChannel = {
  spaceId: string;
  name: string;    // space displayName (fallback: the id)
  snippet: string;
  time: string;
  unread: boolean;
  url: string;     // Space.spaceUri
};
export type ChatChannelsData = { channels: ChatChannel[] };

// --- Drive (starred files) ---
export const DRIVE_TYPE = "gws.drive";

export const driveConfigSchema = z.object({
  showDocs: z.boolean().default(true).describe("Show Docs"),
  showSheets: z.boolean().default(true).describe("Show Sheets"),
  showSlides: z.boolean().default(true).describe("Show Slides"),
  showOther: z.boolean().default(true).describe("Show other files"),
  limit: z.number().int().min(1).max(100).default(25).describe("Max files"),
});
export type DriveConfig = z.infer<typeof driveConfigSchema>;
export const driveDefaultConfig: DriveConfig = {
  showDocs: true,
  showSheets: true,
  showSlides: true,
  showOther: true,
  limit: 25,
};

export type DriveCategory = "docs" | "sheets" | "slides" | "other";
export type DriveFileItem = {
  id: string;
  name: string;
  category: DriveCategory;
  modifiedTime: string; // ISO ("" if unknown)
  url: string; // webViewLink
  iconLink: string; // Google per-type icon URL ("" if missing)
};
export type DriveData = { files: DriveFileItem[] }; // ALL starred (unfiltered); the widget filters.

/** Drop files whose category toggle is off. Pure — safe to import from client or server. */
export function filterDriveFiles(files: DriveFileItem[], config: DriveConfig): DriveFileItem[] {
  const enabled: Record<DriveCategory, boolean> = {
    docs: config.showDocs,
    sheets: config.showSheets,
    slides: config.showSlides,
    other: config.showOther,
  };
  return files.filter((f) => enabled[f.category]);
}

// --- Tasks (a single task list) ---
export const TASKS_TYPE = "gws.tasks";

export const tasksConfigSchema = z.object({
  tasklist: z.string().default("@default").meta({ optionsKey: TASK_LISTS_KEY }).describe("Task list"),
  showCompleted: z.boolean().default(false).describe("Show completed tasks"),
  limit: z.number().int().min(1).max(100).default(25).describe("Max tasks"),
});
export type TasksConfig = z.infer<typeof tasksConfigSchema>;
export const tasksDefaultConfig: TasksConfig = { tasklist: "@default", showCompleted: false, limit: 25 };

export type TaskItem = {
  id: string;
  title: string;
  notes?: string; // free-text note (often a Jira/GitHub URL)
  due: string; // ISO date ("" if none)
  completed: boolean;
  completedAt?: string; // RFC3339 completion timestamp ("" if not completed)
  url: string; // webViewLink into Google Tasks
};
export type TasksData = { tasks: TaskItem[] };

// --- Next meeting (countdown) ---
export const NEXT_MEETING_TYPE = "gws.nextMeeting";

export const nextMeetingConfigSchema = z.object({
  calendarId: z.string().default("primary").meta({ optionsKey: CALENDARS_KEY }).describe("Calendar"),
  includeSoloEvents: z
    .boolean()
    .default(false)
    .describe("Count solo events (no other attendees, no Meet link)"),
});
export type NextMeetingConfig = z.infer<typeof nextMeetingConfigSchema>;
export const nextMeetingDefaultConfig: NextMeetingConfig = {
  calendarId: "primary",
  includeSoloEvents: false,
};

export type MeetingItem = {
  id: string;
  title: string;
  start: string; // ISO datetime (timed events only — all-day is filtered out)
  end: string;
  meetUrl?: string;
  url: string; // htmlLink
};
/** All in-progress or not-yet-started qualifying meetings today, sorted by start. */
export type NextMeetingData = { meetings: MeetingItem[] };

/** Derive the running and upcoming meeting at `now`. Pure — safe to import from client or server. */
export function deriveMeetingState(
  meetings: MeetingItem[],
  now: Date,
): { current: MeetingItem | null; next: MeetingItem | null } {
  const t = now.getTime();
  const current =
    meetings.find((m) => new Date(m.start).getTime() <= t && t < new Date(m.end).getTime()) ?? null;
  const next = meetings.find((m) => new Date(m.start).getTime() > t) ?? null;
  return { current, next };
}

export const gmailManifest = defineManifest({
  type: GMAIL_TYPE, title: "Gmail",
  configSchema: gmailConfigSchema, defaultConfig: gmailDefaultConfig,
  integration: "gws",
});
export const calendarManifest = defineManifest({
  type: CALENDAR_TYPE, title: "Calendar",
  configSchema: calendarConfigSchema, defaultConfig: calendarDefaultConfig,
  integration: "gws",
});
export const chatDmsManifest = defineManifest({
  type: CHAT_DMS_TYPE, title: "Unread DMs",
  configSchema: chatDmsConfigSchema, defaultConfig: chatDmsDefaultConfig,
  integration: "gws",
});
export const chatChannelsManifest = defineManifest({
  type: CHAT_CHANNELS_TYPE, title: "Chat Channels",
  configSchema: chatChannelsConfigSchema, defaultConfig: chatChannelsDefaultConfig,
  integration: "gws",
});
export const driveManifest = defineManifest({
  type: DRIVE_TYPE, title: "Starred files",
  configSchema: driveConfigSchema, defaultConfig: driveDefaultConfig,
  integration: "gws",
});
export const tasksManifest = defineManifest({
  type: TASKS_TYPE, title: "Tasks",
  configSchema: tasksConfigSchema, defaultConfig: tasksDefaultConfig,
  integration: "gws",
});
export const nextMeetingManifest = defineManifest({
  type: NEXT_MEETING_TYPE, title: "Next meeting",
  configSchema: nextMeetingConfigSchema, defaultConfig: nextMeetingDefaultConfig,
  integration: "gws",
});
