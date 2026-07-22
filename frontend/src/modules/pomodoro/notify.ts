import { Pomodoro } from "@/lib/backend";

/**
 * Fire a native notification for a phase ending (the Go side lazily requests
 * permission on first use). Resolves false (never rejects) when permission is
 * denied or delivery fails — the engine shows an in-card hint but keeps
 * timing.
 */
export async function notifyPhaseEnd(title: string, body: string): Promise<boolean> {
  try {
    return await Pomodoro.Notify(title, body);
  } catch {
    return false;
  }
}
