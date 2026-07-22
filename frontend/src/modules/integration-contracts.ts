// Types only — no runtime deps, safe to import from client code.

export interface IntegrationHealth {
  installed: boolean;
  authed: boolean | "n/a"; // "n/a" when the tool has no auth
  detail?: string;         // human message when unhealthy
}

export interface IntegrationTool {
  bin: string;
  installHint: string;
  authHint: string;
}

export interface Integration {
  id: string;
  name: string;
  tool?: IntegrationTool;
  checkHealth(): Promise<IntegrationHealth>;
}

/** Resolved, client-facing view of an integration. */
export interface IntegrationStatus {
  id: string;
  name: string;
  tool: IntegrationTool | null;
  health: IntegrationHealth;
  enabled: boolean;
  override: boolean | null;
  widgetCount: number;
}
