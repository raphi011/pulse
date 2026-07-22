import { describe, it, expect } from "vitest";
import "@/modules/fetch";
import { getFetchWidget } from "@/modules/fetch-registry";
import { POMODORO_TYPE, pomodoroDefaultConfig } from "@/modules/pomodoro/manifest";

describe("pomodoro fetch registration", () => {
  it("registers pomodoro.timer on the fetch registry with defaults", () => {
    const def = getFetchWidget(POMODORO_TYPE);
    expect(def).toBeDefined();
    expect(def!.manifest.defaultConfig).toEqual(pomodoroDefaultConfig);
    expect(typeof def!.fetch).toBe("function");
  });

  it("fetch returns an empty payload (data comes from the live engine)", async () => {
    const def = getFetchWidget(POMODORO_TYPE);
    await expect(def!.fetch(pomodoroDefaultConfig)).resolves.toEqual({});
  });
});

import "@/modules/render";
import { getRenderWidget } from "@/modules/render-registry";

describe("pomodoro render registration", () => {
  it("registers pomodoro.timer on the render registry as a live, non-refreshable widget", () => {
    const def = getRenderWidget(POMODORO_TYPE);
    expect(def).toBeDefined();
    expect(def!.manifest.title).toBe("Pomodoro");
    expect(def!.manifest.refreshable).toBe(false);
    expect(def!.manifest.integration).toBeUndefined();
    expect(def!.Component).toBeDefined();
    expect(def!.icon).toBeDefined();
  });

  it("both sides share the same manifest object", () => {
    expect(getFetchWidget(POMODORO_TYPE)!.manifest).toBe(getRenderWidget(POMODORO_TYPE)!.manifest);
  });
});
