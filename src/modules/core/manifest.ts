import { z } from "zod";

export const STATUS_TYPE = "core.status";

export const statusConfigSchema = z.object({
  label: z.string().default("System"),
});
export type StatusConfig = z.infer<typeof statusConfigSchema>;
export const statusDefaultConfig: StatusConfig = { label: "System" };

export type StatusData = {
  now: string;      // ISO timestamp
  node: string;     // process.version
  platform: string; // process.platform
};
