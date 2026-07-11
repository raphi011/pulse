import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

/**
 * Fire a native notification for a phase ending. Lazily requests permission on
 * first use. Resolves false (never rejects) when permission is denied or the
 * plugin throws — the engine shows an in-card hint but keeps timing.
 */
export async function notifyPhaseEnd(title: string, body: string): Promise<boolean> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (!granted) return false;
    sendNotification({ title, body });
    return true;
  } catch {
    return false;
  }
}
