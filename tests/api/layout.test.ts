import { describe, it, expect, beforeEach } from "vitest";
import { useTempDb } from "../helpers/db";
import "@/modules/fetch";
import { GET as getLayout, PATCH as patchLayout } from "@/app/api/layout/route";
import { POST as addWidget } from "@/app/api/widgets/route";
import { PATCH as patchWidget, DELETE as delWidget } from "@/app/api/widgets/[id]/route";

beforeEach(() => useTempDb());

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("layout API", () => {
  it("adds a widget and returns it in the layout", async () => {
    const res = await addWidget(new Request("http://x/api/widgets", {
      method: "POST", body: JSON.stringify({ type: "core.status" }),
    }));
    expect(res.status).toBe(201);
    const layout = await (await getLayout()).json();
    expect(layout.widgets).toHaveLength(1);
  });

  it("rejects an unknown widget type", async () => {
    const res = await addWidget(new Request("http://x/api/widgets", {
      method: "POST", body: JSON.stringify({ type: "does.not.exist" }),
    }));
    expect(res.status).toBe(400);
  });

  it("persists positions via PATCH /api/layout", async () => {
    const added = await (await addWidget(new Request("http://x/api/widgets", {
      method: "POST", body: JSON.stringify({ type: "core.status" }),
    }))).json();
    const res = await patchLayout(new Request("http://x/api/layout", {
      method: "PATCH",
      body: JSON.stringify({ positions: [{ id: added.id, order: 0, colSpan: 3, rowSpan: 8 }] }),
    }));
    expect(res.status).toBe(200);
    const layout = await (await getLayout()).json();
    expect(layout.widgets[0]).toMatchObject({ colSpan: 3, rowSpan: 8 });
  });

  it("hides then deletes a widget", async () => {
    const added = await (await addWidget(new Request("http://x/api/widgets", {
      method: "POST", body: JSON.stringify({ type: "core.status" }),
    }))).json();
    await patchWidget(new Request("http://x", { method: "PATCH", body: JSON.stringify({ hidden: true }) }), ctx(added.id));
    let layout = await (await getLayout()).json();
    expect(layout.widgets[0].hidden).toBe(true);
    const del = await delWidget(new Request("http://x", { method: "DELETE" }), ctx(added.id));
    expect(del.status).toBe(200);
    layout = await (await getLayout()).json();
    expect(layout.widgets).toHaveLength(0);
  });
});
