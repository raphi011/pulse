import { gwsJson } from "./gws";
import type {
  ChatDmsConfig, ChatDmsData, ChatChannelsConfig, ChatChannelsData, ChatDm, ChatChannel,
} from "./manifest";

// --- Raw gws Chat/People API shapes (only the fields we read; see tests/fixtures/gws/chat) ---
type Space = { name: string; displayName?: string; spaceType?: string; spaceUri?: string; lastActiveTime?: string };
type SpacesResp = { spaces?: Space[] };
type ReadState = { name?: string; lastReadTime?: string };
type ChatUser = { name?: string; type?: string }; // NOTE: Chat's sender/member has NO displayName
type Message = { name: string; text?: string; createTime?: string; sender?: ChatUser };
type MessagesResp = { messages?: Message[] };
type Person = {
  names?: { displayName?: string }[];
  photos?: { url?: string; default?: boolean }[];
};
type PersonResponse = { requestedResourceName?: string; person?: Person };
type BatchGetResp = { responses?: PersonResponse[] };

/** A space is unread when its last message is newer than the caller's last read time. */
export function isUnread(lastActiveTime?: string, lastReadTime?: string): boolean {
  if (!lastActiveTime) return false; // no messages yet
  if (!lastReadTime) return true;    // never read
  return new Date(lastActiveTime).getTime() > new Date(lastReadTime).getTime();
}

/** "users/12345/spaces/AAAA/spaceReadState" -> "users/12345" (or null). */
export function callerUserId(readStateName?: string): string | null {
  const m = readStateName?.match(/^(users\/[^/]+)\//);
  return m ? m[1] : null;
}

/** Chat sender id "users/12345" -> People API resource "people/12345" (or null). */
export function peopleResourceName(userName?: string): string | null {
  const m = userName?.match(/^users\/(.+)$/);
  return m ? `people/${m[1]}` : null;
}

export function normalizeDm(space: Space, msg: Message, partner: string | null, avatarUrl: string | null): ChatDm {
  return {
    spaceId: space.name,
    partner: partner?.trim() || "Direct message",
    avatarUrl: avatarUrl ?? "",
    snippet: msg.text?.trim() ?? "",
    time: msg.createTime ?? space.lastActiveTime ?? "",
    url: space.spaceUri ?? "",
  };
}

export function normalizeChannel(spaceId: string, space: Space, rs: ReadState, msg?: Message): ChatChannel {
  return {
    spaceId,
    name: space.displayName?.trim() || spaceId,
    snippet: msg?.text?.trim() ?? "",
    time: msg?.createTime ?? space.lastActiveTime ?? "",
    unread: isUnread(space.lastActiveTime, rs.lastReadTime),
    url: space.spaceUri ?? "",
  };
}

export async function fetchChatDms(config: ChatDmsConfig): Promise<ChatDmsData> {
  const list = await gwsJson<SpacesResp>([
    "chat", "spaces", "list",
    "--params", JSON.stringify({ filter: 'spaceType = "DIRECT_MESSAGE"', pageSize: 1000 }),
  ]);
  const dmSpaces = (list.spaces ?? [])
    .filter((s) => s.lastActiveTime)
    .sort((a, b) => new Date(b.lastActiveTime!).getTime() - new Date(a.lastActiveTime!).getTime())
    .slice(0, config.limit);

  // Read state per candidate (light). One failure shouldn't sink the widget.
  const readStates = await Promise.allSettled(
    dmSpaces.map((space) =>
      gwsJson<ReadState>([
        "chat", "users", "spaces", "getSpaceReadState",
        "--params", JSON.stringify({ name: `users/me/${space.name}/spaceReadState` }),
      ]).then((rs) => ({ space, rs })),
    ),
  );
  const unread = readStates
    .filter((r): r is PromiseFulfilledResult<{ space: Space; rs: ReadState }> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter(({ space, rs }) => isUnread(space.lastActiveTime, rs.lastReadTime))
    .map(({ space, rs }) => ({ space, me: callerUserId(rs.name) }));

  // For each unread DM: fetch the latest message (snippet/time/partner id). Partner-name resolution
  // is deferred and batched below — one People call for all DMs instead of one per DM (N+1 → 1).
  const settled = await Promise.allSettled(
    unread.map(async ({ space, me }) => {
      const resp = await gwsJson<MessagesResp>([
        "chat", "spaces", "messages", "list",
        "--params", JSON.stringify({ parent: space.name, orderBy: "createTime desc", pageSize: 1 }),
      ]);
      const msg = resp.messages?.[0];
      if (!msg) return null;
      if (me && msg.sender?.name === me) return null; // self-sent — best-effort (skipped if read-state name lacked a user id); real API always provides it
      return { space, msg };
    }),
  );
  const enriched: { space: Space; msg: Message }[] = [];
  const errors: string[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") { if (r.value) enriched.push(r.value); }
    else errors.push(unread[i].space.name); // couldn't load this DM's latest message — surface, don't drop silently
  });

  const partners = await resolvePartners(enriched.map((e) => e.msg.sender?.name));
  const dms = enriched.map(({ space, msg }) => {
    const p = partners.get(msg.sender?.name ?? "") ?? { name: null, photo: null };
    return normalizeDm(space, msg, p.name, p.photo);
  });

  return errors.length ? { dms, errors } : { dms };
}

export async function fetchChatChannels(config: ChatChannelsConfig): Promise<ChatChannelsData> {
  const results = await Promise.allSettled(
    config.spaceIds.map(async (spaceId) => {
      // Any one of these rejecting (e.g. a stale/404 id) drops just this space.
      const [space, rs, msgs] = await Promise.all([
        gwsJson<Space>(["chat", "spaces", "get", "--params", JSON.stringify({ name: spaceId })]),
        gwsJson<ReadState>([
          "chat", "users", "spaces", "getSpaceReadState",
          "--params", JSON.stringify({ name: `users/me/${spaceId}/spaceReadState` }),
        ]),
        gwsJson<MessagesResp>([
          "chat", "spaces", "messages", "list",
          "--params", JSON.stringify({ parent: spaceId, orderBy: "createTime desc", pageSize: 1 }),
        ]),
      ]);
      return normalizeChannel(spaceId, space, rs, msgs.messages?.[0]);
    }),
  );
  const channels: ChatChannel[] = [];
  const errors: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") channels.push(r.value);
    else errors.push(config.spaceIds[i]); // a stale/404 space id: surface which one, don't drop silently
  });
  return errors.length ? { channels, errors } : { channels };
}

type Partner = { name: string | null; photo: string | null };

function personToPartner(person?: Person): Partner {
  // Skip Google's generic silhouette (`default: true`) so the widget falls back to initials.
  const photo = person?.photos?.find((p) => p.url && !p.default)?.url ?? null;
  return { name: person?.names?.[0]?.displayName ?? null, photo };
}

/**
 * Resolve many Chat sender ids ("users/<id>") to display names + avatars in ONE People
 * `getBatchGet` call (up to 200 resource names) instead of one `people.get` per DM. Returns a map
 * keyed by the original sender id; a whole-call failure or a missing person falls back to null,
 * so normalizeDm degrades to "Direct message" exactly as the per-call version did.
 */
async function resolvePartners(senderNames: (string | undefined)[]): Promise<Map<string, Partner>> {
  const map = new Map<string, Partner>();
  // sender "users/123" -> People resource "people/123"; drop unresolvable/duplicate ids.
  const pairs = senderNames
    .map((sender) => ({ sender, resource: peopleResourceName(sender) }))
    .filter((p): p is { sender: string; resource: string } => !!p.sender && !!p.resource);
  const resources = [...new Set(pairs.map((p) => p.resource))];
  if (!resources.length) return map;

  const byResource = new Map<string, Partner>();
  try {
    const resp = await gwsJson<BatchGetResp>([
      "people", "people", "getBatchGet",
      "--params", JSON.stringify({ resourceNames: resources, personFields: "names,photos" }),
    ]);
    for (const r of resp.responses ?? []) {
      if (r.requestedResourceName) byResource.set(r.requestedResourceName, personToPartner(r.person));
    }
  } catch {
    // Whole batch failed — every partner falls back to null (widget shows "Direct message").
  }
  for (const { sender, resource } of pairs) {
    map.set(sender, byResource.get(resource) ?? { name: null, photo: null });
  }
  return map;
}
