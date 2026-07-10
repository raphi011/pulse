import { registerClientWidget } from "@/modules/client-registry";
import {
  GMAIL_TYPE, CALENDAR_TYPE, CHAT_DMS_TYPE, CHAT_CHANNELS_TYPE, DRIVE_TYPE,
  gmailConfigSchema, gmailDefaultConfig,
  calendarConfigSchema, calendarDefaultConfig,
  chatDmsConfigSchema, chatDmsDefaultConfig,
  chatChannelsConfigSchema, chatChannelsDefaultConfig,
  driveConfigSchema, driveDefaultConfig, filterDriveFiles,
  TASKS_TYPE, tasksConfigSchema, tasksDefaultConfig,
} from "./manifest";
import { GmailWidget } from "./widgets/gmail-widget";
import { CalendarWidget } from "./widgets/calendar-widget";
import { ChatDmsWidget } from "./widgets/chat-dms-widget";
import { ChatChannelsWidget } from "./widgets/chat-channels-widget";
import { DriveWidget } from "./widgets/drive-widget";
import { TasksWidget } from "./widgets/tasks-widget";

registerClientWidget({
  type: GMAIL_TYPE, title: "Gmail", Component: GmailWidget,
  configSchema: gmailConfigSchema, defaultConfig: gmailDefaultConfig,
  count: (d) => d.emails.length,
  integration: "gws",
});
registerClientWidget({
  type: CALENDAR_TYPE, title: "Calendar", Component: CalendarWidget,
  configSchema: calendarConfigSchema, defaultConfig: calendarDefaultConfig,
  count: (d) => d.events.length,
  integration: "gws",
});
registerClientWidget({
  type: CHAT_DMS_TYPE, title: "Unread DMs", Component: ChatDmsWidget,
  configSchema: chatDmsConfigSchema, defaultConfig: chatDmsDefaultConfig,
  count: (d) => d.dms.length,
  integration: "gws",
});
registerClientWidget({
  type: CHAT_CHANNELS_TYPE, title: "Chat Channels", Component: ChatChannelsWidget,
  configSchema: chatChannelsConfigSchema, defaultConfig: chatChannelsDefaultConfig,
  count: (d) => d.channels.length,
  integration: "gws",
});
registerClientWidget({
  type: DRIVE_TYPE, title: "Starred files", Component: DriveWidget,
  configSchema: driveConfigSchema, defaultConfig: driveDefaultConfig,
  count: (d, c) => filterDriveFiles(d.files, c).length,
  integration: "gws",
});
registerClientWidget({
  type: TASKS_TYPE, title: "Tasks", Component: TasksWidget,
  configSchema: tasksConfigSchema, defaultConfig: tasksDefaultConfig,
  count: (d) => d.tasks.length,
  integration: "gws",
});
