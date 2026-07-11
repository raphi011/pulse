import { registerFetchWidget } from "@/modules/fetch-registry";
import {
  GMAIL_TYPE, CALENDAR_TYPE,
  CHAT_DMS_TYPE, CHAT_CHANNELS_TYPE, DRIVE_TYPE,
  gmailConfigSchema, gmailDefaultConfig,
  calendarConfigSchema, calendarDefaultConfig,
  chatDmsConfigSchema, chatDmsDefaultConfig,
  chatChannelsConfigSchema, chatChannelsDefaultConfig,
  driveConfigSchema, driveDefaultConfig,
  TASKS_TYPE, tasksConfigSchema, tasksDefaultConfig,
} from "./manifest";
import { fetchGmail } from "./gmail";
import { fetchCalendar } from "./calendar";
import { fetchChatDms, fetchChatChannels } from "./chat";
import { fetchDrive } from "./drive";
import { fetchTasks } from "./tasks";

registerFetchWidget({
  type: GMAIL_TYPE, configSchema: gmailConfigSchema, defaultConfig: gmailDefaultConfig, fetch: fetchGmail,
});
registerFetchWidget({
  type: CALENDAR_TYPE, configSchema: calendarConfigSchema, defaultConfig: calendarDefaultConfig, fetch: fetchCalendar,
});
registerFetchWidget({
  type: CHAT_DMS_TYPE, configSchema: chatDmsConfigSchema, defaultConfig: chatDmsDefaultConfig, fetch: fetchChatDms,
});
registerFetchWidget({
  type: CHAT_CHANNELS_TYPE, configSchema: chatChannelsConfigSchema, defaultConfig: chatChannelsDefaultConfig, fetch: fetchChatChannels,
});
registerFetchWidget({
  type: DRIVE_TYPE, configSchema: driveConfigSchema, defaultConfig: driveDefaultConfig, fetch: fetchDrive,
});
registerFetchWidget({
  type: TASKS_TYPE, configSchema: tasksConfigSchema, defaultConfig: tasksDefaultConfig, fetch: fetchTasks,
});
