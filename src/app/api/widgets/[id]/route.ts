import { NextResponse } from "next/server";
import { setHidden, removeWidget, getWidget } from "@/server/config-repo";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getWidget(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json()) as { hidden?: boolean };
  if (typeof body.hidden === "boolean") setHidden(id, body.hidden);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  removeWidget(id);
  return NextResponse.json({ ok: true });
}
