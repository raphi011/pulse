import { registerClientWidget } from "@/modules/client-registry";
import {
  GMAIL_TYPE, CALENDAR_TYPE, CHAT_DMS_TYPE, CHAT_CHANNELS_TYPE, DRIVE_TYPE,
  gmailConfigSchema, gmailDefaultConfig,
  calendarConfigSchema, calendarDefaultConfig,
  chatDmsConfigSchema, chatDmsDefaultConfig,
  chatChannelsConfigSchema, chatChannelsDefaultConfig,
  driveConfigSchema, driveDefaultConfig,
} from "./manifest";
import { GmailWidget } from "./widgets/gmail-widget";
import { CalendarWidget } from "./widgets/calendar-widget";
import { ChatDmsWidget } from "./widgets/chat-dms-widget";
import { ChatChannelsWidget } from "./widgets/chat-channels-widget";
import { DriveWidget } from "./widgets/drive-widget";

registerClientWidget({
  type: GMAIL_TYPE, title: "Gmail", Component: GmailWidget,
  configSchema: gmailConfigSchema, defaultConfig: gmailDefaultConfig,
});
registerClientWidget({
  type: CALENDAR_TYPE, title: "Calendar", Component: CalendarWidget,
  configSchema: calendarConfigSchema, defaultConfig: calendarDefaultConfig,
});
registerClientWidget({
  type: CHAT_DMS_TYPE, title: "Unread DMs", Component: ChatDmsWidget,
  configSchema: chatDmsConfigSchema, defaultConfig: chatDmsDefaultConfig,
});
registerClientWidget({
  type: CHAT_CHANNELS_TYPE, title: "Chat Channels", Component: ChatChannelsWidget,
  configSchema: chatChannelsConfigSchema, defaultConfig: chatChannelsDefaultConfig,
});
registerClientWidget({
  type: DRIVE_TYPE, title: "Starred files", Component: DriveWidget,
  configSchema: driveConfigSchema, defaultConfig: driveDefaultConfig,
});
