import { registerFetch } from "@/modules/fetch-registry";
import { jqlManifest } from "./manifest";
import { fetchJql } from "./jql";

registerFetch(jqlManifest, { fetch: fetchJql });
