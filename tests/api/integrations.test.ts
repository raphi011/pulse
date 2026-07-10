import { describe, it, expect, beforeEach } from "vitest";
import { useTempDb } from "../helpers/db";
import { GET } from "@/app/api/integrations/route";
import { POST } from "@/app/api/integrations/[id]/toggle/route";
import { addWidget } from "@/server/config-repo";

beforeEach(() => useTempDb());

async function toggle(id: string, body: object) {
  return POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) });
}

describe("integrations API", () => {
  it("GET returns a status per registered integration", async () => {
    const res = await GET(new Request("http://x/api/integrations"));
    const statuses = await res.json();
    expect(statuses.map((s: { id: string }) => s.id).sort()).toEqual(["github", "gws", "jira"]);
  });

  it("disable with widgets returns 409 confirm-required", async () => {
    await addWidget("github.prs", { authors: [], limit: 20 });
    const res = await toggle("github", { enabled: false });
    expect(res.status).toBe(409);
    expect((await res.json()).widgetCount).toBe(1);
  });

  it("confirmed disable deletes widgets and returns updated statuses", async () => {
    await addWidget("github.prs", { authors: [], limit: 20 });
    const res = await toggle("github", { enabled: false, deleteWidgets: true });
    expect(res.status).toBe(200);
    const statuses = await res.json();
    expect(statuses.find((s: { id: string }) => s.id === "github").enabled).toBe(false);
  });
});
