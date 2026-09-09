/**
 * Connection diagnostics and scope discovery.
 *
 * The most common failure is a key that authenticates fine but was generated
 * inside a customer tenant rather than issued as an MSP key by Check Point
 * Support: every /msp/* call then answers "403 MSP endpoint, access denied".
 * avanan_test_connection makes that visible in one call. avanan_list_scopes shows the farm:tenant scopes an MSP
 * key can pass to the tenant-security tools.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { apiRequest } from "../utils/client.js";
import type { CallToolResult } from "../utils/types.js";

export const diagnosticTools: Tool[] = [
  {
    name: "avanan_test_connection",
    description:
      "Verify the configured Avanan credentials: performs the auth handshake, lists the key's scopes, and probes an MSP endpoint to confirm the key is MSP-scoped. Run this first when MSP tools return 403.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "avanan_list_scopes",
    description:
      "List the farm:tenant scopes this key can query. A customer-tenant key has one; an MSP key has one per managed customer, usable as `scopes` / `scope` on the event, search and action tools.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

export async function handleDiagnosticTool(
  name: string,
  _args: Record<string, unknown>
): Promise<CallToolResult> {
  switch (name) {
    case "avanan_list_scopes": {
      const res = await apiRequest<string[]>("/scopes");
      const scopes = res.responseData ?? [];
      const lines = [`${scopes.length} scope${scopes.length === 1 ? "" : "s"}.`, "", JSON.stringify(scopes, null, 2)];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
    case "avanan_test_connection":
      return testConnection();
    default:
      return { content: [{ type: "text", text: `Unknown diagnostic tool: ${name}` }], isError: true };
  }
}

async function testConnection(): Promise<CallToolResult> {
  // Any valid key can read its own scopes; this also exercises the auth handshake.
  const scopes = await apiRequest<string[]>("/scopes");
  const lines = [
    "Authentication: OK",
    `Key scopes: ${(scopes.responseData ?? []).join(", ") || "(none)"}`,
  ];

  try {
    const licenses = await apiRequest<unknown[]>("/msp/licenses");
    const count = licenses.responseData?.length ?? 0;
    lines.push(`MSP access: OK (${count} license package${count === 1 ? "" : "s"} visible)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/\b403\b/.test(message)) {
      lines.push(
        `MSP access: DENIED (${message})`,
        "This key authenticates but is not MSP-scoped (it was generated inside a customer tenant). MSP API keys are not self-service: request one, one per region, from Check Point/Avanan Support, or through your distributor if you buy Avanan through the channel. The tenant-security tools (events, search, exceptions, actions) still work with this key."
      );
    } else {
      lines.push(`MSP access: ERROR (${message})`);
    }
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}
