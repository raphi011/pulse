"use client";
import type { BrandMark } from "@/modules/contracts";

/** Renders a widget/integration brand logo. Returns null when no mark is set. */
export function BrandIcon({ mark }: { mark?: BrandMark }) {
  if (!mark) return null;
  const { Icon, className } = mark;
  return <Icon aria-hidden className={`h-4 w-4 shrink-0 ${className ?? ""}`} />;
}
