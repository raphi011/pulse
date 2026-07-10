import { NextResponse } from "next/server";
import "@/modules/fetch";
import "@/modules/render";
import "@/modules/integrations";
import { getIntegrationStatuses } from "@/server/integration-service";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const recheck = new URL(req.url).searchParams.get("recheck") === "1";
  return NextResponse.json(await getIntegrationStatuses(recheck));
}
