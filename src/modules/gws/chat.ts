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
