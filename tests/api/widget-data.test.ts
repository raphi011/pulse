import { describe, it, expect, beforeEach } from "vitest";
import { useTempDb } from "../helpers/db";
import "@/modules/fetch";
import { addWidget } from "@/server/config-repo";
import { GET } from "@/app/api/widgets/[id]/data/route";

beforeEach(() => useTempDb());

describe("widget data API", () => {
  it("404s for unknown widget", async () => {
    const res = await GET(new Request("http://x/api/widgets/nope/data"), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("returns cached data with status ok", async () => {
    const w = await addWidget("core.status", { label: "System" });
    const res = await GET(new Request(`http://x/api/widgets/${w.id}/data`), { params: Promise.resolve({ id: w.id }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.payload.node).toBe(process.version);
    expect(body.fetchedAt).toBeGreaterThan(0);
  });
});
