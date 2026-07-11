import { z } from "zod";

export const STATUS_TYPE = "core.status";

export const statusConfigSchema = z.object({
  label: z.string().default("System"),
});
export type StatusConfig = z.infer<typeof statusConfigSchema>;
export const statusDefaultConfig: StatusConfig = { label: "System" };

export type StatusData = {
  now: string;       // ISO timestamp
  platform: string;  // OS platform, e.g. "macos" (@tauri-apps/plugin-os platform())
  osVersion: string; // OS version string (plugin-os version())
  arch: string;      // CPU architecture, e.g. "aarch64" (plugin-os arch())
};
