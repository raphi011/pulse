import { z } from "zod";

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
  calendarId: z.string().default("primary").describe("Calendar ID"),
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
    .describe("Space IDs (spaces/…) — run `gws chat spaces list`"),
});
export type ChatChannelsConfig = z.infer<typeof chatChannelsConfigSchema>;
export const chatChannelsDefaultConfig: ChatChannelsConfig = { spaceIds: [] };

export type ChatDm = {
  spaceId: string; // "spaces/AAAA"
  partner: string; // People-API-resolved name (fallback "Direct message")
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
