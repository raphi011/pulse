import { NextResponse } from "next/server";
import "@/modules/fetch";
import { getWidgetData } from "@/server/widget-service";
import { NotFoundError } from "@/server/errors";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  try {
    const row = await getWidgetData(id, refresh);
    return NextResponse.json(row);
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
