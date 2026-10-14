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
 *       X-Avanan-Client-Id, X-Avanan-Client-Secret, optional X-Avanan-Region.
 *       Missing headers are rejected. Gateway mode never falls back to AVANAN_*.
 *
 * HTTP transport refuses to start unless CONDUIT_S2S_SECRET is a real secret.
 * Known placeholders are rejected. MCP_ALLOW_INSECURE_DEV=1 is a local-only
 * escape hatch: it logs a warning and listens on 127.0.0.1 only.
 * A configured secret still honors MCP_HTTP_HOST. The default bind is 127.0.0.1.
 * /health stays unauthenticated and does not read credentials.
 * stdio does not use S2S auth.
 */

import { realpathSync } from "node:fs";
import {
  createServer as createHttpServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
  type Server as HttpServer,
} from "node:http";
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

const LOOPBACK_HOST = "127.0.0.1";

/**
 * Public example values. A copied placeholder must not verify as a real
 * X-Gateway-S2S secret. Match is case-insensitive after trim.
 */
const KNOWN_S2S_PLACEHOLDER_SECRETS = new Set([
  "replace-with-a-real-secret",
  "your-s2s-secret",
  "your-secret",
  "changeme",
  "change-me",
  "placeholder",
  "secret",
  "example",
  "replace-me",
  "s2s-secret",
]);

const MISSING_S2S_SECRET_ERROR =
  "Refusing to start HTTP transport: CONDUIT_S2S_SECRET is empty. " +
  "Set CONDUIT_S2S_SECRET to the gateway-provisioned secret (openssl rand -hex 32), " +
  "or set MCP_ALLOW_INSECURE_DEV=1 for local development only.";

const PLACEHOLDER_S2S_SECRET_ERROR =
  "Refusing to start HTTP transport: CONDUIT_S2S_SECRET is a known placeholder. " +
  "Generate a secret with `openssl rand -hex 32` and set CONDUIT_S2S_SECRET to that value.";

const INSECURE_DEV_WARNING =
  "SECURITY WARNING: CONDUIT_S2S_SECRET is empty and MCP_ALLOW_INSECURE_DEV=1. " +
  "HTTP /mcp is not enforcing X-Gateway-S2S and is listening on 127.0.0.1 only. " +
  "Do not use this outside local development.";

const S2S_UNAUTHORIZED = {
  error:
    "Missing or invalid X-Gateway-S2S header: this endpoint only accepts requests signed by the gateway.",
};

const GATEWAY_CREDENTIALS_UNAUTHORIZED = {
  error: "Missing credentials",
  message: "Gateway mode requires X-Avanan-Client-Id and X-Avanan-Client-Secret headers",
  required: ["X-Avanan-Client-Id", "X-Avanan-Client-Secret"],
  optional: ["X-Avanan-Region"],
};

function headerValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[(.+)\]$/, "$1");
  if (normalized === "localhost" || normalized === "::1" || normalized === LOOPBACK_HOST) return true;
  const bare = normalized.startsWith("::ffff:") ? normalized.slice("::ffff:".length) : normalized;
  const parts = bare.split(".");
  if (parts.length !== 4) return false;
  if (parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  return parts[0] === "127";
}

/**
 * Secret for X-Gateway-S2S. Read at HTTP startup, not module load.
 * Empty or a known placeholder is fail-closed unless MCP_ALLOW_INSECURE_DEV=1
 * (placeholders are never accepted, even with that flag). The secret value
 * is never written to logs.
 */
function resolveHttpS2sSecret(): { secret: string; insecureDev: boolean } {
  const raw = (process.env.CONDUIT_S2S_SECRET ?? "").trim();
  if (raw && KNOWN_S2S_PLACEHOLDER_SECRETS.has(raw.toLowerCase())) {
    logger.error(PLACEHOLDER_S2S_SECRET_ERROR);
    process.exit(1);
  }
  if (raw) return { secret: raw, insecureDev: false };
  if (process.env.MCP_ALLOW_INSECURE_DEV === "1") {
    // error level so LOG_LEVEL=warn|error cannot hide the bypass.
    logger.error(INSECURE_DEV_WARNING);
    return { secret: "", insecureDev: true };
  }
  logger.error(MISSING_S2S_SECRET_ERROR);
  process.exit(1);
}

/**
 * No secret: always 127.0.0.1, including when MCP_HTTP_HOST is a wider address.
 * A configured secret honors MCP_HTTP_HOST and defaults to 127.0.0.1 when unset.
 */
function resolveListenHost(insecureDev: boolean): string {
  const configured = (process.env.MCP_HTTP_HOST ?? "").trim();
  if (!insecureDev) return configured || LOOPBACK_HOST;
  if (configured && !isLoopbackHost(configured)) {
    logger.error(
      `MCP_HTTP_HOST=${configured} is not a loopback address. ` +
        "MCP_ALLOW_INSECURE_DEV=1 without CONDUIT_S2S_SECRET cannot listen there. " +
        `Binding ${LOOPBACK_HOST} only.`
    );
  }
  return LOOPBACK_HOST;
}

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
  const { secret: s2sSecret, insecureDev } = resolveHttpS2sSecret();
  const host = resolveListenHost(insecureDev);
  const isGatewayMode = process.env.AUTH_MODE === "gateway";

  const http = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Liveness only. Must not read credentials: in gateway mode they arrive
    // per request, and this route stays unauthenticated for container probes.
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", name: "avanan-legacy-mcp" }));
      return;
    }

    // S2S guard runs first: a forged request must never reach credential
    // handling, where the first tool call would mint an Avanan token.
    // Empty s2sSecret is only reachable when MCP_ALLOW_INSECURE_DEV=1.
    if (s2sSecret && !verifyS2sHeader(s2sHeader(req.headers), s2sSecret)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify(S2S_UNAUTHORIZED));
      return;
    }

    const creds = extractCredentialsFromHeaders(req.headers);
    if (isGatewayMode && !creds) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify(GATEWAY_CREDENTIALS_UNAUTHORIZED));
      return;
    }

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

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, host, () => resolve());
  });
  const bound = http.address();
  logger.info("Avanan legacy MCP server listening", {
    host,
    port: bound && typeof bound !== "string" ? bound.port : port,
    s2sEnforced: s2sSecret !== "",
    authMode: isGatewayMode ? "gateway" : "env",
  });
  return http;
}

function s2sHeader(headers: IncomingHttpHeaders): string | undefined {
  return headerValue(headers[S2S_HEADER]);
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
