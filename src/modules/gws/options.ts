import { gwsJson } from "./gws";
import { registerFieldOptions, type FieldOption } from "@/modules/field-options";

export const TASK_LISTS_KEY = "gws.taskLists";
export const CALENDARS_KEY = "gws.calendars";
export const CHAT_SPACES_KEY = "gws.chatSpaces";

type ListResp = { id: string; title?: string }[];
type CalItem = { id: string; summary?: string; primary?: boolean };
type SpaceItem = { name: string; displayName?: string };

export async function fetchTaskListOptions(): Promise<FieldOption[]> {
  const resp = await gwsJson<{ items?: ListResp }>(["tasks", "tasklists", "list"]);
  return (resp.items ?? []).map((t) => ({ value: t.id, label: t.title || t.id }));
}

export async function fetchCalendarOptions(): Promise<FieldOption[]> {
  const resp = await gwsJson<{ items?: CalItem[] }>(["calendar", "calendarList", "list"]);
  return (resp.items ?? []).map((c) => ({
    value: c.id,
    label: c.primary ? `${c.summary || c.id} (primary)` : c.summary || c.id,
  }));
}

export async function fetchChatSpaceOptions(): Promise<FieldOption[]> {
  const resp = await gwsJson<{ spaces?: SpaceItem[] }>(["chat", "spaces", "list"]);
  return (resp.spaces ?? []).map((s) => ({ value: s.name, label: s.displayName || s.name }));
}

/** Register every gws live-options provider. Called from gws/fetch.ts at app start. */
export function registerGwsFieldOptions(): void {
  registerFieldOptions(TASK_LISTS_KEY, fetchTaskListOptions);
  registerFieldOptions(CALENDARS_KEY, fetchCalendarOptions);
  registerFieldOptions(CHAT_SPACES_KEY, fetchChatSpaceOptions);
}
