import { gwsJson } from "./gws";
import { registerFieldOptions, type FieldOption } from "@/modules/field-options";
import { TASK_LISTS_KEY, CALENDARS_KEY, CHAT_SPACES_KEY } from "./option-keys";
export { TASK_LISTS_KEY, CALENDARS_KEY, CHAT_SPACES_KEY };

type ListResp = { id: string; title?: string }[];
type CalItem = { id: string; summary?: string; primary?: boolean };
type SpaceItem = { name: string; displayName?: string; spaceType?: string };

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

/** All chat spaces, paged through so the options list isn't silently capped at the API's page size. */
async function listAllChatSpaces(): Promise<SpaceItem[]> {
  const all: SpaceItem[] = [];
  let pageToken: string | undefined;
  // Cap pages so a misbehaving nextPageToken can't loop forever.
  for (let page = 0; page < 20; page++) {
    const params: Record<string, unknown> = { pageSize: 1000 };
    if (pageToken) params.pageToken = pageToken;
    const resp = await gwsJson<{ spaces?: SpaceItem[]; nextPageToken?: string }>([
      "chat", "spaces", "list", "--params", JSON.stringify(params),
    ]);
    all.push(...(resp.spaces ?? []));
    if (!resp.nextPageToken) break;
    pageToken = resp.nextPageToken;
  }
  return all;
}

export async function fetchChatSpaceOptions(): Promise<FieldOption[]> {
  const spaces = await listAllChatSpaces();
  return spaces.map((s) => ({
    // DMs carry no displayName — label them clearly instead of surfacing the raw "spaces/…" id.
    value: s.name,
    label: s.displayName || (s.spaceType === "DIRECT_MESSAGE" ? "Direct message" : s.name),
  }));
}

/** Register every gws live-options provider. Called from gws/fetch.ts at app start. */
export function registerGwsFieldOptions(): void {
  registerFieldOptions(TASK_LISTS_KEY, fetchTaskListOptions);
  registerFieldOptions(CALENDARS_KEY, fetchCalendarOptions);
  registerFieldOptions(CHAT_SPACES_KEY, fetchChatSpaceOptions);
}
