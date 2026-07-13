import { gwsJson } from "./gws";
import type { EmailItem, GmailData, GmailConfig } from "./manifest";

type ListResp = { messages?: { id: string; threadId: string }[] };
type Header = { name: string; value: string };
type MsgResp = {
  id: string;
  labelIds?: string[];
  internalDate?: string; // epoch millis, as a string
  payload?: { headers?: Header[] };
};

function header(msg: MsgResp, name: string): string {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

/** "Jane Doe <jane@x.com>" → "Jane Doe"; a bare address stays as-is. */
export function parseFrom(raw: string): string {
  const named = raw.match(/^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/);
  return named?.[1]?.trim() || raw.trim();
}

export function normalizeMessage(msg: MsgResp): EmailItem {
  return {
    id: msg.id,
    subject: header(msg, "Subject") || "(no subject)",
    from: parseFrom(header(msg, "From")),
    date: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : "",
    unread: msg.labelIds?.includes("UNREAD") ?? false,
    url: `https://mail.google.com/mail/u/0/#inbox/${msg.id}`,
  };
}

export async function fetchGmail(config: GmailConfig): Promise<GmailData> {
  const list = await gwsJson<ListResp>([
    "gmail", "users", "messages", "list",
    "--params", JSON.stringify({ userId: "me", q: config.query, maxResults: config.limit }),
  ]);
  const ids = (list.messages ?? []).map((m) => m.id);

  // list returns IDs only — fetch each message's headers. `format=metadata` returns all
  // headers; the `metadataHeaders` filter is intentionally omitted (gws drops the headers
  // entirely when it's passed). One failure shouldn't sink the whole widget.
  const settled = await Promise.allSettled(
    ids.map((id) =>
      gwsJson<MsgResp>([
        "gmail", "users", "messages", "get",
        "--params", JSON.stringify({ userId: "me", id, format: "metadata" }),
      ]),
    ),
  );
  const emails = settled
    .filter((r): r is PromiseFulfilledResult<MsgResp> => r.status === "fulfilled")
    .map((r) => normalizeMessage(r.value));
  return { emails };
}

/** Archive: remove the INBOX label (message stays searchable, leaves the inbox). */
export async function archiveEmail(id: string): Promise<void> {
  await gwsJson<unknown>([
    "gmail", "users", "messages", "modify",
    "--params", JSON.stringify({ userId: "me", id }),
    "--json", JSON.stringify({ removeLabelIds: ["INBOX"] }),
  ]);
}

/** Mark read: remove the UNREAD label. */
export async function markEmailRead(id: string): Promise<void> {
  await gwsJson<unknown>([
    "gmail", "users", "messages", "modify",
    "--params", JSON.stringify({ userId: "me", id }),
    "--json", JSON.stringify({ removeLabelIds: ["UNREAD"] }),
  ]);
}

/** Trash: move to Trash (reversible in Gmail for 30 days). */
export async function trashEmail(id: string): Promise<void> {
  await gwsJson<unknown>([
    "gmail", "users", "messages", "trash",
    "--params", JSON.stringify({ userId: "me", id }),
  ]);
}
