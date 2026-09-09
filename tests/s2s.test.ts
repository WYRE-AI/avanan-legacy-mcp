// Conduit gateway service-to-service (S2S) verification, gateway#377 parity.
// The sidecar is provisioned with CONDUIT_S2S_SECRET (its own derived
// subkey); when set, every /mcp request must carry X-Gateway-S2S:
//   t=<unixSeconds>,v1=<hex HMAC-SHA256(secret, "t=<unixSeconds>")>
// and the guard runs BEFORE any credential handling, so a forged request
// never triggers an Avanan auth handshake.

import { createHmac } from "node:crypto";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { httpRequest } from "../src/utils/transport.js";
import { S2S_HEADER, verifyS2sHeader } from "../src/s2s-verify.js";

vi.mock("../src/utils/transport.js", () => ({ httpRequest: vi.fn() }));
const transport = vi.mocked(httpRequest);

const SECRET = "test-s2s-secret-do-not-use";
const now = () => Math.floor(Date.now() / 1000);
const mint = (secret: string, t = now()) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`t=${t}`).digest("hex")}`;

describe("verifyS2sHeader", () => {
  it("exposes the lowercase header name Node presents", () => {
    expect(S2S_HEADER).toBe("x-gateway-s2s");
  });

  it("accepts a fresh header minted with the same secret", () => {
    expect(verifyS2sHeader(mint(SECRET), SECRET)).toBe(true);
  });

  it("rejects a header minted with a different secret", () => {
    expect(verifyS2sHeader(mint("other-secret"), SECRET)).toBe(false);
  });

  it("rejects a header outside the skew window", () => {
    expect(verifyS2sHeader(mint(SECRET, now() - 301), SECRET)).toBe(false);
    expect(verifyS2sHeader(mint(SECRET, now() + 301), SECRET)).toBe(false);
    expect(verifyS2sHeader(mint(SECRET, now() - 299), SECRET)).toBe(true);
  });

  it("rejects malformed values", () => {
    expect(verifyS2sHeader("", SECRET)).toBe(false);
    expect(verifyS2sHeader(undefined, SECRET)).toBe(false);
    expect(verifyS2sHeader("t=abc,v1=00", SECRET)).toBe(false);
    expect(verifyS2sHeader(`t=${now()},v1=${"0".repeat(63)}`, SECRET)).toBe(false);
    expect(verifyS2sHeader(`v1=${"0".repeat(64)},t=${now()}`, SECRET)).toBe(false);
  });

  it("never verifies when the secret is empty (enforcement disabled upstream)", () => {
    expect(verifyS2sHeader(mint(""), "")).toBe(false);
  });
});

describe("HTTP /mcp guard", () => {
  const PORT = 47131;
  const BASE = `http://127.0.0.1:${PORT}`;
  let server: Server;

  const TOOLS_LIST = { jsonrpc: "2.0", method: "tools/list", id: 1 };
  const TOOL_CALL = {
    jsonrpc: "2.0",
    method: "tools/call",
    params: { name: "avanan_list_scopes", arguments: {} },
    id: 2,
  };
  const CRED_HEADERS = { "x-avanan-client-id": "id", "x-avanan-client-secret": "secret" };

  const post = (headers: Record<string, string>, body: unknown) =>
    fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    process.env.CONDUIT_S2S_SECRET = SECRET;
    const { startHttp } = await import("../src/index.js");
    server = await startHttp(PORT);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    transport.mockReset();
  });

  it("serves /health without a header", async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
  });

  it("rejects a missing header with 401 before any Avanan call", async () => {
    const res = await post(CRED_HEADERS, TOOL_CALL);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error:
        "Missing or invalid X-Gateway-S2S header: this endpoint only accepts requests signed by the gateway.",
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects a header minted with the wrong secret", async () => {
    const res = await post({ ...CRED_HEADERS, [S2S_HEADER]: mint("wrong") }, TOOL_CALL);
    expect(res.status).toBe(401);
    expect(transport).not.toHaveBeenCalled();
  });

  it("accepts a valid header and serves tools/list", async () => {
    const res = await post({ ...CRED_HEADERS, [S2S_HEADER]: mint(SECRET) }, TOOLS_LIST);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("avanan_test_connection");
  });
});
