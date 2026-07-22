import { registerFetch } from "@/modules/fetch-registry";
import { summaryManifest, heatmapManifest } from "./manifest";
import { fetchSummary, fetchHeatmap } from "./stats";

registerFetch(summaryManifest, { fetch: fetchSummary });
registerFetch(heatmapManifest, { fetch: fetchHeatmap });
