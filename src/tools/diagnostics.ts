/**
 * Connection diagnostics.
 *
 * The most common failure is a key that authenticates fine but was generated
 * inside a customer tenant rather than the MSP portal: every /msp/* call then
 * answers "403 MSP endpoint, access denied". This tool makes that visible in
 * one call instead of leaving the operator guessing at signatures.
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
];

export async function handleDiagnosticTool(
  name: string,
  _args: Record<string, unknown>
): Promise<CallToolResult> {
  if (name !== "avanan_test_connection") {
    return { content: [{ type: "text", text: `Unknown diagnostic tool: ${name}` }], isError: true };
  }

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
        "This key authenticates but is not MSP-scoped. Generate an MSP API key from the Avanan MSP portal, not from inside a customer tenant."
      );
    } else {
      lines.push(`MSP access: ERROR (${message})`);
    }
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}
