import { NextResponse } from "next/server";
import { getWidgets, setPositions, getPref } from "@/server/config-repo";

export const runtime = "nodejs";

export async function GET() {
  const [widgetRows, theme] = await Promise.all([getWidgets(), getPref("theme", "dark")]);
  return NextResponse.json({ widgets: widgetRows, prefs: { theme } });
}

export async function PATCH(req: Request) {
  let body: { positions?: { id: string; order: number; colSpan: number; rowSpan: number }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (body.positions !== undefined) {
    if (!Array.isArray(body.positions)) {
      return NextResponse.json({ error: "positions must be an array" }, { status: 400 });
    }
    await setPositions(body.positions);
  }
  return NextResponse.json({ ok: true });
}
