import "server-only";
import { registerServerWidget } from "@/modules/server-registry";
import {
  GMAIL_TYPE, CALENDAR_TYPE,
  gmailConfigSchema, gmailDefaultConfig,
  calendarConfigSchema, calendarDefaultConfig,
} from "./manifest";
import { fetchGmail } from "./gmail";
import { fetchCalendar } from "./calendar";

registerServerWidget({
  type: GMAIL_TYPE, configSchema: gmailConfigSchema, defaultConfig: gmailDefaultConfig, fetch: fetchGmail,
});
registerServerWidget({
  type: CALENDAR_TYPE, configSchema: calendarConfigSchema, defaultConfig: calendarDefaultConfig, fetch: fetchCalendar,
});
