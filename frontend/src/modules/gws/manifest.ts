export const GMAIL_TYPE = "gws.gmail";
export const CALENDAR_TYPE = "gws.calendar";
export const CHAT_DMS_TYPE = "gws.chatDms";
export const CHAT_CHANNELS_TYPE = "gws.chatChannels";
export const DRIVE_TYPE = "gws.drive";
export const TASKS_TYPE = "gws.tasks";
export const NEXT_MEETING_TYPE = "gws.nextMeeting";

// Config shapes mirror the Go manifests (forms are generated server-side).
export interface GmailConfig { query: string; limit: number }
export interface CalendarConfig { calendarId: string; limit: number }
export interface ChatDmsConfig { limit: number }
export interface ChatChannelsConfig { spaceIds: string[] }
export interface DriveConfig {
  showDocs: boolean; showSheets: boolean; showSlides: boolean; showOther: boolean; limit: number;
}
export type CompletedMaxAge = "Today" | "Last 7 days" | "Last 30 days" | "All time";
export interface TasksConfig {
  tasklist: string; showCompleted: boolean; completedMaxAge: CompletedMaxAge; limit: number;
}
export interface NextMeetingConfig { calendarId: string; includeSoloEvents: boolean }

// --- Data shapes (payloads produced by internal/modules/gws) ---
export type EmailItem = {
  id: string;
  subject: string;
  from: string; // display name, falling back to the raw From header
  date: string; // ISO timestamp ("" if unknown)
  unread: boolean;
  url: string; // Gmail deep link
};
/** `errors`: labels of messages whose per-item fetch failed (N+1 enrichment). Optional/additive. */
export type GmailData = { emails: EmailItem[]; errors?: string[] };

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

/** Which events to dim (already over) and which single event to highlight
 *  (in progress, else next upcoming). All-day events are never dimmed or
 *  highlighted. Pure — safe to import from client or server. */
export function deriveEventEmphasis(
  events: CalendarEventItem[],
  now: Date,
): { pastIds: Set<string>; highlightId: string | null } {
  const t = now.getTime();
  const timed = events.filter((e) => !e.allDay);
  const pastIds = new Set(
    timed.filter((e) => new Date(e.end || e.start).getTime() <= t).map((e) => e.id),
  );
  const current = timed.find(
    (e) => new Date(e.start).getTime() <= t && t < new Date(e.end || e.start).getTime(),
  );
  const next = timed.find((e) => new Date(e.start).getTime() > t);
  return { pastIds, highlightId: current?.id ?? next?.id ?? null };
}

export type ChatDm = {
  spaceId: string; // "spaces/AAAA"
  partner: string; // People-API-resolved name (fallback "Direct message")
  avatarUrl: string; // People API photo url ("" when missing or a default silhouette)
  snippet: string; // latest message text, trimmed
  time: string;    // ISO createTime of latest message
  url: string;     // Space.spaceUri
};
export type ChatDmsData = { dms: ChatDm[]; errors?: string[] };

export type ChatChannel = {
  spaceId: string;
  name: string;    // space displayName (fallback: the id)
  snippet: string;
  time: string;
  unread: boolean;
  url: string;     // Space.spaceUri
};
export type ChatChannelsData = { channels: ChatChannel[]; errors?: string[] };

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

/** Millisecond cutoff for a completed-age bucket, or null for "All time". Pure. */
function ageCutoff(maxAge: CompletedMaxAge, now: Date): number | null {
  switch (maxAge) {
    case "All time":
      return null;
    case "Today": {
      const midnight = new Date(now);
      midnight.setHours(0, 0, 0, 0);
      return midnight.getTime();
    }
    case "Last 7 days":
      return now.getTime() - 7 * 24 * 60 * 60 * 1000;
    case "Last 30 days":
      return now.getTime() - 30 * 24 * 60 * 60 * 1000;
  }
}

/**
 * Drop completed tasks older than the configured age. Incomplete tasks are always
 * kept; a completed task with no timestamp is kept (fail-open, so nothing silently
 * vanishes). Pure — safe to import from client or server.
 */
export function filterTasksByAge(tasks: TaskItem[], maxAge: CompletedMaxAge, now: Date): TaskItem[] {
  const cutoff = ageCutoff(maxAge, now);
  if (cutoff === null) return tasks;
  return tasks.filter((t) => {
    if (!t.completed || !t.completedAt) return true;
    return new Date(t.completedAt).getTime() >= cutoff;
  });
}

/** Incomplete tasks first (preserving order), completed tasks last. Stable. Pure. */
export function sortTasks(tasks: TaskItem[]): TaskItem[] {
  return [...tasks].sort((a, b) => Number(a.completed) - Number(b.completed));
}

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
