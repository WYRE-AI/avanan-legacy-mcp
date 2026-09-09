#!/usr/bin/env node
/**
 * Avanan MSP SmartAPI MCP Server.
 *
 * Implements the Avanan MSP SmartAPI (Jan 2024 reference guide):
 *   - Child MSP partner management
 *   - MSP user CRUD
 *   - Customer tenant CRUD
 *   - License + add-on listing, license assignment
 *   - Monthly/daily usage reporting
 *
 * Transports:
 *   - stdio (default): for local Claude Desktop / CLI usage
 *   - http: for hosted deployment via the WYRE MCP gateway
 *
 * Auth modes:
 *   - env (default): AVANAN_CLIENT_ID + AVANAN_CLIENT_SECRET, optional AVANAN_REGION
 *   - gateway: credentials injected per-request from
 *       X-Avanan-Client-Id, X-Avanan-Client-Secret, optional X-Avanan-Region
 */

import { realpathSync } from "node:fs";
import { createServer as createHttpServer, IncomingMessage, ServerResponse, type Server as HttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { logger } from "./utils/logger.js";
import { credentialStore, extractCredentialsFromHeaders } from "./utils/credential-store.js";
import { registerResourceHandlers } from "./resources.js";
import { partnerTools, handlePartnerTool } from "./tools/partners.js";
import { userTools, handleUserTool } from "./tools/users.js";
import { tenantTools, handleTenantTool } from "./tools/tenants.js";
import { licenseTools, handleLicenseTool } from "./tools/licenses.js";
import { usageTools, handleUsageTool } from "./tools/usage.js";
import { diagnosticTools, handleDiagnosticTool } from "./tools/diagnostics.js";
import { eventTools, handleEventTool } from "./tools/events.js";
import { searchTools, handleSearchTool } from "./tools/search.js";
import { exceptionTools, handleExceptionTool } from "./tools/exceptions.js";
import { actionTools, handleActionTool } from "./tools/actions.js";
import { verifyS2sHeader, S2S_HEADER } from "./s2s-verify.js";
import type { CallToolResult } from "./utils/types.js";

// Conduit service-to-service auth (gateway#377 parity). Non-empty =
// enforce X-Gateway-S2S on every /mcp request; empty = disabled, behavior
// exactly as before (dark-by-default until the gateway provisions this
// container's derived subkey). See src/s2s-verify.ts.
const S2S_SECRET = process.env.CONDUIT_S2S_SECRET || "";

const ALL_TOOLS = [
  ...diagnosticTools,
  ...eventTools,
  ...searchTools,
  ...exceptionTools,
  ...actionTools,
  ...partnerTools,
  ...userTools,
  ...tenantTools,
  ...licenseTools,
  ...usageTools,
];

type ToolHandler = (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;
const TOOL_HANDLERS = new Map<string, ToolHandler>([
  ...diagnosticTools.map((t) => [t.name, handleDiagnosticTool] as [string, ToolHandler]),
  ...eventTools.map((t) => [t.name, handleEventTool] as [string, ToolHandler]),
  ...searchTools.map((t) => [t.name, handleSearchTool] as [string, ToolHandler]),
  ...exceptionTools.map((t) => [t.name, handleExceptionTool] as [string, ToolHandler]),
  ...actionTools.map((t) => [t.name, handleActionTool] as [string, ToolHandler]),
  ...partnerTools.map((t) => [t.name, handlePartnerTool] as [string, ToolHandler]),
  ...userTools.map((t) => [t.name, handleUserTool] as [string, ToolHandler]),
  ...tenantTools.map((t) => [t.name, handleTenantTool] as [string, ToolHandler]),
  ...licenseTools.map((t) => [t.name, handleLicenseTool] as [string, ToolHandler]),
  ...usageTools.map((t) => [t.name, handleUsageTool] as [string, ToolHandler]),
]);

function createMcpServer(): Server {
  const server = new Server(
    { name: "avanan-legacy-mcp", version: "1.0.0" },
    { capabilities: { tools: {}, resources: {} } }
  );

  // MCP Apps (SEP-1865): serves the ui:// tenant card.
  registerResourceHandlers(server);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ALL_TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    logger.info("Tool call", { tool: name });

    try {
      const handler = TOOL_HANDLERS.get(name);
      if (!handler) {
        return {
          content: [{ type: "text", text: `Unknown tool: '${name}'` }],
          isError: true,
        };
      }
      return await handler(name, args as Record<string, unknown>);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Tool call failed", { tool: name, error: message });
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

/* -------------------------------------------------------------------------- */
/* Transports                                                                  */
/* -------------------------------------------------------------------------- */

export async function startStdio(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Avanan legacy MCP server running on stdio");
}

export async function startHttp(port: number): Promise<HttpServer> {
  const http = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", name: "avanan-legacy-mcp" }));
      return;
    }

    // S2S guard runs first: a forged request must never reach credential
    // handling, where the first tool call would mint an Avanan token.
    if (S2S_SECRET && !verifyS2sHeader(req.headers[S2S_HEADER] as string | undefined, S2S_SECRET)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error:
            "Missing or invalid X-Gateway-S2S header: this endpoint only accepts requests signed by the gateway.",
        })
      );
      return;
    }

    const creds = extractCredentialsFromHeaders(req.headers);
    const handle = async () => {
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    };

    if (creds) {
      await credentialStore.run(creds, handle);
    } else {
      await handle();
    }
  });

  await new Promise<void>((resolve) => http.listen(port, resolve));
  logger.info("Avanan legacy MCP server listening", { port, s2sEnforced: S2S_SECRET !== "" });
  return http;
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

/** True when this file is the process entry point (also via the npm bin symlink). */
function isMain(): boolean {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const transport = (process.env.MCP_TRANSPORT || "stdio").toLowerCase();
  const port = Number(process.env.MCP_HTTP_PORT || 8080);

  if (transport === "http") {
    startHttp(port).catch((err) => {
      logger.error("Failed to start HTTP transport", { err: String(err) });
      process.exit(1);
    });
  } else {
    startStdio().catch((err) => {
      logger.error("Failed to start stdio transport", { err: String(err) });
      process.exit(1);
    });
  }
}
