// HTTP transport fail-closed auth (CWE-306).
//
// Startup requires a real CONDUIT_S2S_SECRET unless MCP_ALLOW_INSECURE_DEV=1.
// Known placeholders are rejected even with that flag. The flag listens on
// 127.0.0.1 only. Gateway mode rejects requests that omit X-Avanan credential
// headers and must not fall back to AVANAN_* in process.env.

import { createHmac } from "node:crypto";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { credentialStore } from "../src/utils/credential-store.js";
import { getCredentials } from "../src/utils/client.js";
import { httpRequest } from "../src/utils/transport.js";
import { startHttp } from "../src/index.js";

vi.mock("../src/utils/transport.js", () => ({ httpRequest: vi.fn() }));
const transport = vi.mocked(httpRequest);

const S2S_SECRET = "test-s2s-secret-do-not-log";
const ENV_CLIENT_ID = "env-client-id-must-not-be-used";
const ENV_CLIENT_SECRET = "env-secret-must-not-be-used";

const PLACEHOLDERS = [
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
] as const;

const ENV_KEYS = [
  "CONDUIT_S2S_SECRET",
  "MCP_ALLOW_INSECURE_DEV",
  "MCP_HTTP_PORT",
  "MCP_HTTP_HOST",
  "AUTH_MODE",
  "AVANAN_CLIENT_ID",
  "AVANAN_CLIENT_SECRET",
  "AVANAN_REGION",
  "LOG_LEVEL",
  "MCP_TRANSPORT",
] as const;

const savedEnv = new Map<string, string | undefined>();
const servers: Server[] = [];

function mintS2sHeader(secret: string, unixSeconds = Math.floor(Date.now() / 1000)): string {
  const message = `t=${unixSeconds}`;
  const hex = createHmac("sha256", secret).update(message).digest("hex");
  return `${message},v1=${hex}`;
}

function silenceLogs(): { text: () => string } {
  const lines: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
  });
  return { text: () => lines.join("\n") };
}

function assertNoSecrets(logged: string, extra: string[] = []): void {
  expect(logged).not.toContain(S2S_SECRET);
  expect(logged).not.toContain(ENV_CLIENT_ID);
  expect(logged).not.toContain(ENV_CLIENT_SECRET);
  for (const value of extra) {
    if (value.toLowerCase() === "placeholder" || value.toLowerCase() === "secret") continue;
    expect(logged).not.toContain(value.trim());
  }
}

async function listen(): Promise<{ server: Server; port: number; address: string }> {
  const server = await startHttp(0);
  servers.push(server);
  const bound = server.address();
  if (!bound || typeof bound === "string") {
    throw new Error("HTTP server did not bind a TCP port");
  }
  return { server, port: bound.port, address: bound.address };
}

function mcpHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...extra,
  };
}

const toolsList = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });

function refuseExit(): void {
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit:${String(code)}`);
  }) as typeof process.exit);
}

beforeAll(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  delete process.env.CONDUIT_S2S_SECRET;
  delete process.env.MCP_ALLOW_INSECURE_DEV;
  delete process.env.MCP_HTTP_HOST;
  delete process.env.AUTH_MODE;
  delete process.env.AVANAN_CLIENT_ID;
  delete process.env.AVANAN_CLIENT_SECRET;
  delete process.env.AVANAN_REGION;
  process.env.LOG_LEVEL = "info";
  transport.mockReset();
});

afterEach(async () => {
  vi.restoreAllMocks();
  while (servers.length > 0) {
    const server = servers.pop();
    if (!server?.listening) continue;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

describe("HTTP startup", () => {
  it("refuses to start when CONDUIT_S2S_SECRET is empty", async () => {
    const logs = silenceLogs();
    refuseExit();
    await expect(startHttp(0)).rejects.toThrow("process.exit:1");
    const text = logs.text();
    expect(text).toContain("Refusing to start HTTP transport");
    expect(text).toContain("CONDUIT_S2S_SECRET is empty");
    assertNoSecrets(text);
  });

  it("still refuses when MCP_ALLOW_INSECURE_DEV is not exactly 1", async () => {
    process.env.MCP_ALLOW_INSECURE_DEV = "true";
    process.env.CONDUIT_S2S_SECRET = "   ";
    const logs = silenceLogs();
    refuseExit();
    await expect(startHttp(0)).rejects.toThrow("process.exit:1");
    expect(logs.text()).toContain("Refusing to start HTTP transport");
    expect(logs.text()).toContain("CONDUIT_S2S_SECRET is empty");
  });

  it.each(PLACEHOLDERS)("refuses known placeholder %s and does not log it", async (placeholder) => {
    process.env.CONDUIT_S2S_SECRET = placeholder;
    process.env.MCP_ALLOW_INSECURE_DEV = "1";
    const logs = silenceLogs();
    refuseExit();
    await expect(startHttp(0)).rejects.toThrow("process.exit:1");
    const text = logs.text();
    expect(text).toContain("known placeholder");
    expect(text).toContain("Refusing to start HTTP transport");
    assertNoSecrets(text, [placeholder]);
  });

  it("refuses a padded or mixed-case placeholder", async () => {
    process.env.CONDUIT_S2S_SECRET = "  ChangeMe  ";
    const logs = silenceLogs();
    refuseExit();
    await expect(startHttp(0)).rejects.toThrow("process.exit:1");
    expect(logs.text()).toContain("known placeholder");
    expect(logs.text()).not.toContain("ChangeMe");
  });

  it("allows startup with a warning when MCP_ALLOW_INSECURE_DEV=1 and binds 127.0.0.1", async () => {
    process.env.MCP_ALLOW_INSECURE_DEV = "1";
    const logs = silenceLogs();
    const server = await listen();
    expect(server.address).toBe("127.0.0.1");
    const text = logs.text();
    expect(text).toContain("SECURITY WARNING");
    expect(text).toContain("CONDUIT_S2S_SECRET");
    expect(text).toContain("MCP_ALLOW_INSECURE_DEV=1");
    expect(text).toContain("127.0.0.1");
    assertNoSecrets(text);
  });

  it.each(["localhost", "::1", "[::1]"])(
    "forces 127.0.0.1 when the dev bypass host is %s",
    async (host) => {
      process.env.MCP_ALLOW_INSECURE_DEV = "1";
      process.env.MCP_HTTP_HOST = host;
      const logs = silenceLogs();
      const server = await listen();
      expect(server.address).toBe("127.0.0.1");
      expect(logs.text()).toContain("SECURITY WARNING");
      expect(logs.text()).not.toContain("not a loopback address");
    }
  );

  it.each(["0.0.0.0", "10.1.2.3"])(
    "forces 127.0.0.1 when the dev bypass host is %s",
    async (host) => {
      process.env.MCP_ALLOW_INSECURE_DEV = "1";
      process.env.MCP_HTTP_HOST = host;
      const logs = silenceLogs();
      const server = await listen();
      expect(server.address).toBe("127.0.0.1");
      const text = logs.text();
      expect(text).toContain(`MCP_HTTP_HOST=${host} is not a loopback address`);
      expect(text).toContain("Binding 127.0.0.1 only");
      assertNoSecrets(text);
    }
  );

  it("honors a non-loopback MCP_HTTP_HOST when CONDUIT_S2S_SECRET is set", async () => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    process.env.MCP_HTTP_HOST = "0.0.0.0";
    process.env.MCP_ALLOW_INSECURE_DEV = "1";
    const logs = silenceLogs();
    const server = await listen();
    expect(server.address).toBe("0.0.0.0");
    expect(logs.text()).not.toContain("not a loopback address");
    assertNoSecrets(logs.text());
  });

  it("binds 127.0.0.1 when MCP_HTTP_HOST is unset and a secret is set", async () => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    const server = await listen();
    expect(server.address).toBe("127.0.0.1");
  });
});

describe("HTTP authentication", () => {
  beforeEach(() => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    process.env.MCP_HTTP_HOST = "127.0.0.1";
    process.env.AUTH_MODE = "gateway";
    process.env.AVANAN_CLIENT_ID = ENV_CLIENT_ID;
    process.env.AVANAN_CLIENT_SECRET = ENV_CLIENT_SECRET;
    process.env.AVANAN_REGION = "eu";
  });

  it("returns 401 when the S2S header is missing or invalid and does not log the secret", async () => {
    const logs = silenceLogs();
    const runSpy = vi.spyOn(credentialStore, "run");
    const { port } = await listen();

    const missing = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: mcpHeaders(),
      body: toolsList,
    });
    const invalid = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: mcpHeaders({ "x-gateway-s2s": mintS2sHeader("wrong-secret") }),
      body: toolsList,
    });

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    const missingBody = await missing.json();
    const invalidBody = await invalid.json();
    expect(missingBody.error).toContain("X-Gateway-S2S");
    expect(invalidBody.error).toContain("X-Gateway-S2S");
    expect(JSON.stringify(missingBody)).not.toContain(S2S_SECRET);
    expect(JSON.stringify(invalidBody)).not.toContain(ENV_CLIENT_ID);
    expect(logs.text()).not.toContain(S2S_SECRET);
    expect(runSpy).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("returns 401 in gateway mode without credential headers and does not use env credentials", async () => {
    const runSpy = vi.spyOn(credentialStore, "run");
    const { port } = await listen();

    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: mcpHeaders({ "x-gateway-s2s": mintS2sHeader(S2S_SECRET) }),
      body: toolsList,
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: "Missing credentials",
      message: "Gateway mode requires X-Avanan-Client-Id and X-Avanan-Client-Secret headers",
      required: ["X-Avanan-Client-Id", "X-Avanan-Client-Secret"],
      optional: ["X-Avanan-Region"],
    });
    expect(JSON.stringify(body)).not.toContain(ENV_CLIENT_ID);
    expect(JSON.stringify(body)).not.toContain(ENV_CLIENT_SECRET);
    expect(JSON.stringify(body)).not.toContain(S2S_SECRET);
    expect(runSpy).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
    expect(getCredentials()).toBeNull();

    const partial = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: mcpHeaders({
        "x-gateway-s2s": mintS2sHeader(S2S_SECRET),
        "x-avanan-client-id": "header-client-id",
      }),
      body: toolsList,
    });
    expect(partial.status).toBe(401);
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("accepts a valid S2S header plus credential headers and uses those credentials", async () => {
    const logs = silenceLogs();
    const runSpy = vi.spyOn(credentialStore, "run");
    const { port } = await listen();

    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: mcpHeaders({
        "x-gateway-s2s": mintS2sHeader(S2S_SECRET),
        "x-avanan-client-id": "header-client-id",
        "x-avanan-client-secret": "header-client-secret",
        "x-avanan-region": "euw2",
      }),
      body: toolsList,
    });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain("avanan_test_connection");
    expect(text).not.toContain(S2S_SECRET);
    expect(text).not.toContain(ENV_CLIENT_ID);
    expect(text).not.toContain(ENV_CLIENT_SECRET);
    expect(runSpy).toHaveBeenCalledWith(
      { clientId: "header-client-id", clientSecret: "header-client-secret", region: "euw2" },
      expect.any(Function)
    );
    expect(logs.text()).not.toContain(S2S_SECRET);
    expect(transport).not.toHaveBeenCalled();
  });

  it("serves /health without authentication and without reading credentials", async () => {
    const runSpy = vi.spyOn(credentialStore, "run");
    const { port } = await listen();
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok", name: "avanan-legacy-mcp" });
    expect(JSON.stringify(body)).not.toContain(S2S_SECRET);
    expect(JSON.stringify(body)).not.toContain(ENV_CLIENT_ID);
    expect(runSpy).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("does not enforce X-Gateway-S2S when the insecure dev bypass is on", async () => {
    delete process.env.CONDUIT_S2S_SECRET;
    delete process.env.AUTH_MODE;
    process.env.MCP_ALLOW_INSECURE_DEV = "1";
    process.env.MCP_HTTP_HOST = "0.0.0.0";
    const { port, address } = await listen();
    expect(address).toBe("127.0.0.1");
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: mcpHeaders(),
      body: toolsList,
    });
    expect(response.status).toBe(200);
    expect(transport).not.toHaveBeenCalled();
  });
});
