import { describe, it, expect, beforeEach } from "vitest";
import { useTempDb } from "../helpers/db";
import "@/modules/fetch";
import { addWidget, getWidget } from "@/server/config-repo";
import { PATCH } from "@/app/api/widgets/[id]/route";

beforeEach(() => useTempDb());

function patch(id: string, body: unknown) {
  return PATCH(new Request(`http://x/api/widgets/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) });
}

describe("PATCH /api/widgets/[id] config", () => {
  it("persists a valid config", async () => {
    const w = addWidget("github.failingActions", { repos: [], limit: 10 });
    const res = await patch(w.id, { config: { repos: ["o/r"], limit: 5 } });
    expect(res.status).toBe(200);
    expect(getWidget(w.id)?.config).toEqual({ repos: ["o/r"], limit: 5 });
  });

  it("rejects an invalid config with 400 and does not write", async () => {
    const w = addWidget("github.failingActions", { repos: [], limit: 10 });
    const res = await patch(w.id, { config: { repos: "not-an-array", limit: 5 } });
    expect(res.status).toBe(400);
    expect(getWidget(w.id)?.config).toEqual({ repos: [], limit: 10 });
  });

  it("rejects a repo that is not owner/name", async () => {
    const w = addWidget("github.failingActions", { repos: [], limit: 10 });
    const res = await patch(w.id, { config: { repos: ["owner/name?foo=bar"], limit: 5 } });
    expect(res.status).toBe(400);
    expect(getWidget(w.id)?.config).toEqual({ repos: [], limit: 10 });
  });

  it("returns the stored (parsed) config so the client avoids drift", async () => {
    const w = addWidget("github.failingActions", { repos: [], limit: 10 });
    // limit omitted → schema default (10) should be applied and echoed back
    const res = await patch(w.id, { config: { repos: ["o/r"] } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config).toEqual({ repos: ["o/r"], limit: 10 });
  });

  it("still toggles hidden", async () => {
    const w = addWidget("core.status", { label: "System" });
    const res = await patch(w.id, { hidden: true });
    expect(res.status).toBe(200);
    expect(getWidget(w.id)?.hidden).toBe(true);
  });

  it("sets a title override and echoes it back", async () => {
    const w = addWidget("core.status", { label: "System" });
    const res = await patch(w.id, { title: "My PRs" });
    expect(res.status).toBe(200);
    expect((await res.json()).title).toBe("My PRs");
    expect(getWidget(w.id)?.title).toBe("My PRs");
  });

  it("clears the title back to default when blank", async () => {
    const w = addWidget("core.status", { label: "System" });
    await patch(w.id, { title: "Renamed" });
    const res = await patch(w.id, { title: "" });
    expect(res.status).toBe(200);
    expect(getWidget(w.id)?.title).toBeNull();
  });
});
