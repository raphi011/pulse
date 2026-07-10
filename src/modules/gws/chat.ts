import "server-only";
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
type Person = { names?: { displayName?: string }[] };

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

export function normalizeDm(space: Space, msg: Message, partner: string | null): ChatDm {
  return {
    spaceId: space.name,
    partner: partner?.trim() || "Direct message",
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

  // For each unread DM: latest message (snippet/time/partner id), then resolve the name via People API.
  const settled = await Promise.allSettled(
    unread.map(async ({ space, me }) => {
      const resp = await gwsJson<MessagesResp>([
        "chat", "spaces", "messages", "list",
        "--params", JSON.stringify({ parent: space.name, orderBy: "createTime desc", pageSize: 1 }),
      ]);
      const msg = resp.messages?.[0];
      if (!msg) return null;
      if (me && msg.sender?.name === me) return null; // self-sent — best-effort (skipped if read-state name lacked a user id); real API always provides it
      const partner = await resolvePartnerName(msg.sender?.name);
      return normalizeDm(space, msg, partner);
    }),
  );
  const dms = settled
    .filter((r): r is PromiseFulfilledResult<ChatDm | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((d): d is ChatDm => d !== null);

  return { dms };
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
  const channels = results
    .filter((r): r is PromiseFulfilledResult<ChatChannel> => r.status === "fulfilled")
    .map((r) => r.value);
  return { channels };
}

/** Resolve a Chat sender id ("users/<id>") to a display name via the People API, or null on failure. */
async function resolvePartnerName(userName?: string): Promise<string | null> {
  const resourceName = peopleResourceName(userName);
  if (!resourceName) return null;
  try {
    const person = await gwsJson<Person>([
      "people", "people", "get",
      "--params", JSON.stringify({ resourceName, personFields: "names" }),
    ]);
    return person.names?.[0]?.displayName ?? null;
  } catch {
    return null; // name lookup failed — normalizeDm falls back to "Direct message"
  }
}
