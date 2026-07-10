import { NextResponse } from "next/server";
import "@/modules/server";
import "@/modules/client";
import "@/modules/integrations";
import { enableIntegration, disableIntegration, getIntegrationStatuses, ConfirmRequiredError } from "@/server/integration-service";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { enabled, deleteWidgets = false } = (await req.json()) as { enabled: boolean; deleteWidgets?: boolean };

  if (enabled) {
    enableIntegration(id);
  } else {
    try {
      disableIntegration(id, deleteWidgets);
    } catch (err) {
      if (err instanceof ConfirmRequiredError) {
        return NextResponse.json({ error: "confirm-required", widgetCount: err.widgetCount }, { status: 409 });
      }
      throw err;
    }
  }
  return NextResponse.json(await getIntegrationStatuses(true));
}
