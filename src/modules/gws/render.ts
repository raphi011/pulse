import {
  SiGmail, SiGooglecalendar, SiGooglechat, SiGoogledrive, SiGoogletasks,
} from "react-icons/si";
import { registerRender } from "@/modules/render-registry";
import {
  gmailManifest, calendarManifest, chatDmsManifest, chatChannelsManifest, driveManifest, tasksManifest,
  nextMeetingManifest, filterDriveFiles,
} from "./manifest";
import { GmailWidget } from "./widgets/gmail-widget";
import { CalendarWidget } from "./widgets/calendar-widget";
import { ChatDmsWidget } from "./widgets/chat-dms-widget";
import { ChatChannelsWidget } from "./widgets/chat-channels-widget";
import { DriveWidget } from "./widgets/drive-widget";
import { TasksWidget } from "./widgets/tasks-widget";
import { NextMeetingWidget } from "./widgets/next-meeting-widget";

registerRender(gmailManifest, {
  Component: GmailWidget,
  count: (d) => d.emails.length,
  icon: { Icon: SiGmail, className: "text-[#EA4335]" },
});
registerRender(calendarManifest, {
  Component: CalendarWidget,
  count: (d) => d.events.length,
  icon: { Icon: SiGooglecalendar, className: "text-[#4285F4]" },
});
registerRender(chatDmsManifest, {
  Component: ChatDmsWidget,
  count: (d) => d.dms.length,
  icon: { Icon: SiGooglechat, className: "text-[#34A853]" },
});
registerRender(chatChannelsManifest, {
  Component: ChatChannelsWidget,
  count: (d) => d.channels.length,
  icon: { Icon: SiGooglechat, className: "text-[#34A853]" },
});
registerRender(driveManifest, {
  Component: DriveWidget,
  count: (d, c) => filterDriveFiles(d.files, c).length,
  icon: { Icon: SiGoogledrive, className: "text-[#4285F4]" },
});
registerRender(tasksManifest, {
  Component: TasksWidget,
  count: (d) => d.tasks.length,
  icon: { Icon: SiGoogletasks, className: "text-[#4285F4]" },
});
registerRender(nextMeetingManifest, {
  Component: NextMeetingWidget,
  count: (d) => d.meetings.length,
  icon: { Icon: SiGooglecalendar, className: "text-[#4285F4]" },
});
