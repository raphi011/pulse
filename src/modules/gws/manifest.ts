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
