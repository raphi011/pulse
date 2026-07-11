import { registerFetch } from "@/modules/fetch-registry";
import { prsManifest, failingActionsManifest, dependabotManifest } from "./manifest";
import { fetchPrs } from "./prs";
import { fetchFailingActions } from "./runs";
import { fetchDependabot } from "./dependabot";

registerFetch(prsManifest, { fetch: fetchPrs });
registerFetch(failingActionsManifest, { fetch: fetchFailingActions });
registerFetch(dependabotManifest, { fetch: fetchDependabot });
