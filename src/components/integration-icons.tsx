"use client";
import { SiGithub, SiJira, SiGoogle } from "react-icons/si";
import type { BrandMark } from "@/modules/contracts";

/**
 * Integration-level brand marks, keyed by integration id. Kept client-side because
 * IntegrationStatus crosses the server→client JSON boundary and can't carry a component.
 */
export const integrationIcons: Record<string, BrandMark> = {
  github: { Icon: SiGithub, className: "text-[#181717] dark:text-white" },
  jira: { Icon: SiJira, className: "text-[#0052CC]" },
  gws: { Icon: SiGoogle, className: "text-[#4285F4]" },
};
