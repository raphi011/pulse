import { registerFetch } from "@/modules/fetch-registry";
import {
  gmailManifest, calendarManifest, chatDmsManifest, chatChannelsManifest, driveManifest, tasksManifest,
  nextMeetingManifest,
} from "./manifest";
import { fetchGmail } from "./gmail";
import { fetchCalendar, fetchNextMeeting } from "./calendar";
import { fetchChatDms, fetchChatChannels } from "./chat";
import { fetchDrive } from "./drive";
import { fetchTasks } from "./tasks";
import { registerGwsFieldOptions } from "./options";

registerFetch(gmailManifest, { fetch: fetchGmail });
registerFetch(calendarManifest, { fetch: fetchCalendar });
registerFetch(chatDmsManifest, { fetch: fetchChatDms });
registerFetch(chatChannelsManifest, { fetch: fetchChatChannels });
registerFetch(driveManifest, { fetch: fetchDrive });
registerFetch(tasksManifest, { fetch: fetchTasks });
registerFetch(nextMeetingManifest, { fetch: fetchNextMeeting });

registerGwsFieldOptions();
