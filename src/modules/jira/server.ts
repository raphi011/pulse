import "server-only";
import { registerServerWidget } from "@/modules/server-registry";
import { JQL_TYPE, jqlConfigSchema, jqlDefaultConfig } from "./manifest";
import { fetchJql } from "./jql";

registerServerWidget({
  type: JQL_TYPE, configSchema: jqlConfigSchema, defaultConfig: jqlDefaultConfig, fetch: fetchJql,
});
