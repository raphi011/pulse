import { z } from "zod";
import { defineManifest } from "@/modules/contracts";

export const CCUSAGE_SPEND_TYPE = "ccusage.spend";

export const ccusageSpendConfigSchema = z.object({
  dailyLimitUsd: z.number().min(0).default(20).describe("Daily limit (USD)"),
});
export type CcusageSpendConfig = z.infer<typeof ccusageSpendConfigSchema>;
export const ccusageSpendDefaultConfig: CcusageSpendConfig = { dailyLimitUsd: 20 };

/** Today's spend as returned by fetch. `date` is the local YYYY-MM-DD it covers. */
export type CcusageSpendData = { costUsd: number; date: string };

export const ccusageSpendManifest = defineManifest({
  type: CCUSAGE_SPEND_TYPE,
  title: "Claude Usage",
  configSchema: ccusageSpendConfigSchema,
  defaultConfig: ccusageSpendDefaultConfig,
  refreshable: true,
  integration: "ccusage",
});
