import {
  SiGmail, SiGooglecalendar, SiGooglechat, SiGoogledrive, SiGoogletasks,
} from "react-icons/si";
import { registerRenderWidget } from "@/modules/render-registry";
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

registerRenderWidget({
  type: GMAIL_TYPE, title: "Gmail", Component: GmailWidget,
  configSchema: gmailConfigSchema, defaultConfig: gmailDefaultConfig,
  count: (d) => d.emails.length,
  integration: "gws",
  icon: { Icon: SiGmail, className: "text-[#EA4335]" },
});
registerRenderWidget({
  type: CALENDAR_TYPE, title: "Calendar", Component: CalendarWidget,
  configSchema: calendarConfigSchema, defaultConfig: calendarDefaultConfig,
  count: (d) => d.events.length,
  integration: "gws",
  icon: { Icon: SiGooglecalendar, className: "text-[#4285F4]" },
});
registerRenderWidget({
  type: CHAT_DMS_TYPE, title: "Unread DMs", Component: ChatDmsWidget,
  configSchema: chatDmsConfigSchema, defaultConfig: chatDmsDefaultConfig,
  count: (d) => d.dms.length,
  integration: "gws",
  icon: { Icon: SiGooglechat, className: "text-[#34A853]" },
});
registerRenderWidget({
  type: CHAT_CHANNELS_TYPE, title: "Chat Channels", Component: ChatChannelsWidget,
  configSchema: chatChannelsConfigSchema, defaultConfig: chatChannelsDefaultConfig,
  count: (d) => d.channels.length,
  integration: "gws",
  icon: { Icon: SiGooglechat, className: "text-[#34A853]" },
});
registerRenderWidget({
  type: DRIVE_TYPE, title: "Starred files", Component: DriveWidget,
  configSchema: driveConfigSchema, defaultConfig: driveDefaultConfig,
  count: (d, c) => filterDriveFiles(d.files, c).length,
  integration: "gws",
  icon: { Icon: SiGoogledrive, className: "text-[#4285F4]" },
});
registerRenderWidget({
  type: TASKS_TYPE, title: "Tasks", Component: TasksWidget,
  configSchema: tasksConfigSchema, defaultConfig: tasksDefaultConfig,
  count: (d) => d.tasks.length,
  integration: "gws",
  icon: { Icon: SiGoogletasks, className: "text-[#4285F4]" },
});
