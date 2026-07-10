import "server-only";
import { registerFetchWidget } from "@/modules/fetch-registry";
import { JQL_TYPE, jqlConfigSchema, jqlDefaultConfig } from "./manifest";
import { fetchJql } from "./jql";

registerFetchWidget({
  type: JQL_TYPE, configSchema: jqlConfigSchema, defaultConfig: jqlDefaultConfig, fetch: fetchJql,
});
