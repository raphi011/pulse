import "server-only";
import { registerServerWidget } from "@/modules/server-registry";
import {
  GMAIL_TYPE, CALENDAR_TYPE,
  CHAT_DMS_TYPE, CHAT_CHANNELS_TYPE, DRIVE_TYPE,
  gmailConfigSchema, gmailDefaultConfig,
  calendarConfigSchema, calendarDefaultConfig,
  chatDmsConfigSchema, chatDmsDefaultConfig,
  chatChannelsConfigSchema, chatChannelsDefaultConfig,
  driveConfigSchema, driveDefaultConfig,
} from "./manifest";
import { fetchGmail } from "./gmail";
import { fetchCalendar } from "./calendar";
import { fetchChatDms, fetchChatChannels } from "./chat";
import { fetchDrive } from "./drive";

registerServerWidget({
  type: GMAIL_TYPE, configSchema: gmailConfigSchema, defaultConfig: gmailDefaultConfig, fetch: fetchGmail,
});
registerServerWidget({
  type: CALENDAR_TYPE, configSchema: calendarConfigSchema, defaultConfig: calendarDefaultConfig, fetch: fetchCalendar,
});
registerServerWidget({
  type: CHAT_DMS_TYPE, configSchema: chatDmsConfigSchema, defaultConfig: chatDmsDefaultConfig, fetch: fetchChatDms,
});
registerServerWidget({
  type: CHAT_CHANNELS_TYPE, configSchema: chatChannelsConfigSchema, defaultConfig: chatChannelsDefaultConfig, fetch: fetchChatChannels,
});
registerServerWidget({
  type: DRIVE_TYPE, configSchema: driveConfigSchema, defaultConfig: driveDefaultConfig, fetch: fetchDrive,
});
