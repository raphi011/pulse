import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-notification", () => mocks);

import { notifyPhaseEnd } from "@/modules/pomodoro/notify";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("notifyPhaseEnd", () => {
  it("sends when permission is already granted", async () => {
    mocks.isPermissionGranted.mockResolvedValue(true);
    await expect(notifyPhaseEnd("T", "B")).resolves.toBe(true);
    expect(mocks.sendNotification).toHaveBeenCalledWith({ title: "T", body: "B" });
    expect(mocks.requestPermission).not.toHaveBeenCalled();
  });

  it("requests permission once when not yet granted, then sends", async () => {
    mocks.isPermissionGranted.mockResolvedValue(false);
    mocks.requestPermission.mockResolvedValue("granted");
    await expect(notifyPhaseEnd("T", "B")).resolves.toBe(true);
    expect(mocks.sendNotification).toHaveBeenCalledOnce();
  });

  it("returns false without sending when permission is denied", async () => {
    mocks.isPermissionGranted.mockResolvedValue(false);
    mocks.requestPermission.mockResolvedValue("denied");
    await expect(notifyPhaseEnd("T", "B")).resolves.toBe(false);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("returns false instead of throwing when the plugin throws", async () => {
    mocks.isPermissionGranted.mockRejectedValue(new Error("no tauri"));
    await expect(notifyPhaseEnd("T", "B")).resolves.toBe(false);
  });
});
