import { registerFetch } from "@/modules/fetch-registry";
import {
  gmailManifest, calendarManifest, chatDmsManifest, chatChannelsManifest, driveManifest, tasksManifest,
} from "./manifest";
import { fetchGmail } from "./gmail";
import { fetchCalendar } from "./calendar";
import { fetchChatDms, fetchChatChannels } from "./chat";
import { fetchDrive } from "./drive";
import { fetchTasks } from "./tasks";

registerFetch(gmailManifest, { fetch: fetchGmail });
registerFetch(calendarManifest, { fetch: fetchCalendar });
registerFetch(chatDmsManifest, { fetch: fetchChatDms });
registerFetch(chatChannelsManifest, { fetch: fetchChatChannels });
registerFetch(driveManifest, { fetch: fetchDrive });
registerFetch(tasksManifest, { fetch: fetchTasks });
