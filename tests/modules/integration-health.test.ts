import { describe, it, expect } from "vitest";
import { probeHealth } from "@/modules/integration-health";
import { CliError } from "@/server/cli";

describe("probeHealth", () => {
  it("reports installed+authed when the probe succeeds", async () => {
    expect(await probeHealth(async () => "ok")).toEqual({ installed: true, authed: true });
  });

  it("reports not-installed on a not-found CliError", async () => {
    const h = await probeHealth(async () => { throw new CliError("gh not found", "not-found"); });
    expect(h.installed).toBe(false);
    expect(h.authed).toBe(false);
    expect(h.detail).toMatch(/not found/);
  });

  it("reports installed-but-unauthed on an auth CliError", async () => {
    const h = await probeHealth(async () => { throw new CliError("run gh auth login", "auth"); });
    expect(h.installed).toBe(true);
    expect(h.authed).toBe(false);
    expect(h.detail).toMatch(/auth login/);
  });

  it("treats other failures as installed-but-unhealthy", async () => {
    const h = await probeHealth(async () => { throw new Error("weird"); });
    expect(h.installed).toBe(true);
    expect(h.authed).toBe(false);
    expect(h.detail).toBe("weird");
  });

  it("reports authed 'n/a' for a no-auth tool on a successful probe", async () => {
    expect(await probeHealth(async () => "ok", { noAuth: true })).toEqual({ installed: true, authed: "n/a" });
  });

  it("keeps authed 'n/a' for a no-auth tool that is installed but whose probe fails", async () => {
    const h = await probeHealth(async () => { throw new Error("weird"); }, { noAuth: true });
    expect(h.installed).toBe(true);
    expect(h.authed).toBe("n/a");
    expect(h.detail).toBe("weird");
  });

  it("still reports not-installed for a no-auth tool that is missing", async () => {
    const h = await probeHealth(async () => { throw new CliError("nope", "not-found"); }, { noAuth: true });
    expect(h.installed).toBe(false);
    expect(h.authed).toBe(false);
  });
});
