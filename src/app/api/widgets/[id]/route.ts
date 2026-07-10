import { NextResponse } from "next/server";
import "@/modules/server";
import { setHidden, setConfig, setTitle, removeWidget, getWidget } from "@/server/config-repo";
import { getServerWidget } from "@/modules/server-registry";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const widget = getWidget(id);
  if (!widget) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json()) as { hidden?: boolean; config?: Record<string, unknown>; title?: string | null };

  if (typeof body.hidden === "boolean") setHidden(id, body.hidden);

  if (body.title !== undefined) setTitle(id, body.title);

  if (body.config !== undefined) {
    const def = getServerWidget(widget.type);
    const parsed = def?.configSchema.safeParse(body.config);
    if (def && parsed && !parsed.success) {
      return NextResponse.json({ error: "Invalid config" }, { status: 400 });
    }
    setConfig(id, (parsed?.success ? parsed.data : body.config) as Record<string, unknown>);
  }

  // Echo the stored config (schema defaults applied) and title so the client stays in sync without a reload.
  const fresh = getWidget(id);
  return NextResponse.json({ ok: true, config: fresh?.config, title: fresh?.title ?? null });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  removeWidget(id);
  return NextResponse.json({ ok: true });
}
