import {
  SiGmail, SiGooglecalendar, SiGooglechat, SiGoogledrive, SiGoogletasks,
} from "react-icons/si";
import { registerRender } from "@/modules/render-registry";
import {
  GMAIL_TYPE, CALENDAR_TYPE, CHAT_DMS_TYPE, CHAT_CHANNELS_TYPE, DRIVE_TYPE, TASKS_TYPE,
  NEXT_MEETING_TYPE, filterDriveFiles,
} from "./manifest";
import { GmailWidget } from "./widgets/gmail-widget";
import { CalendarWidget } from "./widgets/calendar-widget";
import { ChatDmsWidget } from "./widgets/chat-dms-widget";
import { ChatChannelsWidget } from "./widgets/chat-channels-widget";
import { DriveWidget } from "./widgets/drive-widget";
import { TasksWidget } from "./widgets/tasks-widget";
import { NextMeetingWidget } from "./widgets/next-meeting-widget";

registerRender(GMAIL_TYPE, {
  Component: GmailWidget,
  count: (d) => d.emails.length,
  icon: { Icon: SiGmail, className: "text-[#EA4335]" },
});
registerRender(CALENDAR_TYPE, {
  Component: CalendarWidget,
  count: (d) => d.events.length,
  icon: { Icon: SiGooglecalendar, className: "text-[#4285F4]" },
});
registerRender(CHAT_DMS_TYPE, {
  Component: ChatDmsWidget,
  count: (d) => d.dms.length,
  icon: { Icon: SiGooglechat, className: "text-[#34A853]" },
});
registerRender(CHAT_CHANNELS_TYPE, {
  Component: ChatChannelsWidget,
  count: (d) => d.channels.length,
  icon: { Icon: SiGooglechat, className: "text-[#34A853]" },
});
registerRender(DRIVE_TYPE, {
  Component: DriveWidget,
  count: (d, c) => filterDriveFiles(d.files, c).length,
  icon: { Icon: SiGoogledrive, className: "text-[#4285F4]" },
});
registerRender(TASKS_TYPE, {
  Component: TasksWidget,
  count: (d) => d.tasks.length,
  icon: { Icon: SiGoogletasks, className: "text-[#4285F4]" },
});
registerRender(NEXT_MEETING_TYPE, {
  Component: NextMeetingWidget,
  count: (d) => d.meetings.length,
  icon: { Icon: SiGooglecalendar, className: "text-[#4285F4]" },
});
