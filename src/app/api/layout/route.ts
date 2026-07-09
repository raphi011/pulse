import { NextResponse } from "next/server";
import { getWidgets, setPositions, getPref } from "@/server/config-repo";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    widgets: getWidgets(),
    prefs: { columnCount: getPref("columnCount", "3"), theme: getPref("theme", "dark") },
  });
}

export async function PATCH(req: Request) {
  const body = (await req.json()) as { positions?: { id: string; column: number; order: number }[] };
  if (body.positions) setPositions(body.positions);
  return NextResponse.json({ ok: true });
}
