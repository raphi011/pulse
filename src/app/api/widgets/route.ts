import { NextResponse } from "next/server";
import "@/modules/server";
import { getServerWidget } from "@/modules/server-registry";
import { addWidget } from "@/server/config-repo";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { type } = (await req.json()) as { type: string };
  const def = getServerWidget(type);
  if (!def) return NextResponse.json({ error: `Unknown widget type: ${type}` }, { status: 400 });
  const widget = addWidget(type, def.defaultConfig as Record<string, unknown>);
  return NextResponse.json(widget, { status: 201 });
}
