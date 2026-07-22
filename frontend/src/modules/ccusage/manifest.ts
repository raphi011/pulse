export const CCUSAGE_SPEND_TYPE = "ccusage.spend";

/** Mirrors the Go manifest's config field (form is generated server-side). */
export interface CcusageSpendConfig {
  dailyLimitUsd: number;
}

/** Today's spend as returned by the Go module. `date` is the local YYYY-MM-DD it covers. */
export type CcusageSpendData = { costUsd: number; date: string };
