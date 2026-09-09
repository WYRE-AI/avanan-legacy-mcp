/**
 * Avanan MSP SmartAPI HTTP client.
 *
 * Auth model, verified live against smart-api-production-1-us on 2026-09-09
 * (contract pinned in tests/client.test.ts):
 *
 *   1. GET {base}/v1.0/auth, signed with the client secret, returns the JWT as
 *      the raw response body (not JSON). The token is valid for one hour.
 *   2. Every request carries:
 *        x-av-req-id : fresh UUID
 *        x-av-app-id : client ID
 *        x-av-date   : ISO-8601 UTC *without* the trailing "Z". The guide
 *                      documents ".000Z", but the API answers 500 to it.
 *        x-av-sig    : sha256(base64(reqId + appId + date [+ path?query] + secret)), hex
 *        x-av-token  : "" on the auth call, the JWT on every other call
 *      The path with query string is part of the signature on data requests
 *      only. This matches Check Point's reference client.py.
 *
 * Region selection: per-request credentials (gateway) > AVANAN_REGION > "us".
 * Avanan issues one API key per region, so there is nothing to auto-detect.
 */

import { createHash, randomUUID } from "node:crypto";
import { logger } from "./logger.js";
import { getRequestCredentials } from "./credential-store.js";
import { httpRequest } from "./transport.js";
import {
  REGIONAL_BASE_URLS,
  DEFAULT_REGION,
  parseRegion,
  type AvananCredentials,
  type ApiResponse,
} from "./types.js";

const TOKEN_LIFETIME_MS = 3_600_000; // documented: 1 hour
const TOKEN_EXPIRY_BUFFER_MS = 60_000;

/* -------------------------------------------------------------------------- */
/* Credentials                                                                 */
/* -------------------------------------------------------------------------- */

export function getCredentials(): AvananCredentials | null {
  const req = getRequestCredentials();
  if (req) return { ...req, region: req.region ?? parseRegion(process.env.AVANAN_REGION) };

  const clientId = process.env.AVANAN_CLIENT_ID;
  const clientSecret = process.env.AVANAN_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  return { clientId, clientSecret, region: parseRegion(process.env.AVANAN_REGION) };
}

/* -------------------------------------------------------------------------- */
/* Request signing                                                             */
/* -------------------------------------------------------------------------- */

/** x-av-date format the API actually accepts: ISO-8601 UTC, no trailing "Z". */
export function formatAvananDate(date: Date): string {
  return date.toISOString().slice(0, -1);
}

/**
 * Compute the x-av-sig header value.
 * Pass `requestString` (path + query) for data requests; omit it for /auth.
 */
export function signRequest(args: {
  reqId: string;
  appId: string;
  date: string;
  requestString?: string;
  secret: string;
}): string {
  const canonical = args.reqId + args.appId + args.date + (args.requestString ?? "") + args.secret;
  const encoded = Buffer.from(canonical, "utf8").toString("base64");
  return createHash("sha256").update(encoded).digest("hex");
}

function signedHeaders(
  creds: AvananCredentials,
  token: string,
  requestString?: string
): Record<string, string> {
  const reqId = randomUUID();
  const date = formatAvananDate(new Date());
  return {
    accept: "application/json",
    "x-av-req-id": reqId,
    "x-av-app-id": creds.clientId,
    "x-av-date": date,
    "x-av-sig": signRequest({ reqId, appId: creds.clientId, date, requestString, secret: creds.clientSecret }),
    "x-av-token": token,
  };
}

/* -------------------------------------------------------------------------- */
/* Token cache                                                                 */
/* -------------------------------------------------------------------------- */

// Keyed by client ID so concurrent gateway tenants never share a token.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export function clearTokenCache(): void {
  tokenCache.clear();
}

function jwtExpiryMs(token: string): number {
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    if (typeof claims.exp === "number") return claims.exp * 1000;
  } catch {
    // Not a decodable JWT; fall back to the documented lifetime.
  }
  return Date.now() + TOKEN_LIFETIME_MS;
}

async function getToken(creds: AvananCredentials, baseUrl: string): Promise<string> {
  const cached = tokenCache.get(creds.clientId);
  if (cached && Date.now() < cached.expiresAt - TOKEN_EXPIRY_BUFFER_MS) return cached.token;

  const res = await httpRequest({
    url: `${baseUrl}/v1.0/auth`,
    method: "GET",
    headers: signedHeaders(creds, ""),
  });
  if (res.status !== 200) {
    throw new Error(`Avanan authentication failed (${res.status}): ${errorMessage(res.text, res.status)}`);
  }

  const token = res.text.trim();
  tokenCache.set(creds.clientId, { token, expiresAt: jwtExpiryMs(token) });
  logger.debug("Avanan token obtained", { clientId: creds.clientId, baseUrl });
  return token;
}

/* -------------------------------------------------------------------------- */
/* Request                                                                     */
/* -------------------------------------------------------------------------- */

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
}

function errorMessage(text: string, status: number): string {
  try {
    const parsed = JSON.parse(text) as {
      responseEnvelope?: { responseText?: string; additionalText?: string };
      message?: string;
    };
    const env = parsed.responseEnvelope;
    const msg = env?.responseText || env?.additionalText || parsed.message;
    if (msg) return msg;
  } catch {
    // Not JSON; fall through to the raw text.
  }
  return text ? text.slice(0, 200) : `HTTP ${status}`;
}

export async function apiRequest<T = unknown>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<ApiResponse<T>> {
  const creds = getCredentials();
  if (!creds) {
    throw new Error("No Avanan credentials configured. Set AVANAN_CLIENT_ID and AVANAN_CLIENT_SECRET.");
  }

  const baseUrl = REGIONAL_BASE_URLS[creds.region ?? DEFAULT_REGION];
  const token = await getToken(creds, baseUrl);

  const method = options.method ?? "GET";
  const url = new URL(`${baseUrl}/v1.0${path.startsWith("/") ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(options.params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const headers = signedHeaders(creds, token, url.pathname + url.search);
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  if (body !== undefined) headers["content-type"] = "application/json";

  logger.debug("Avanan API request", { method, url: url.toString() });
  const res = await httpRequest({ url: url.toString(), method, headers, body });

  // 204 No Content (deletes)
  if (res.status === 204) {
    return {
      responseEnvelope: { requestId: headers["x-av-req-id"], responseCode: 204, responseText: "Success" },
    };
  }

  if (res.status === 401) tokenCache.delete(creds.clientId);
  if (res.status < 200 || res.status >= 300) {
    const msg = errorMessage(res.text, res.status);
    logger.error("Avanan API error", { status: res.status, url: url.toString(), msg });
    throw new Error(`Avanan API error (${res.status}): ${msg}`);
  }

  try {
    return JSON.parse(res.text) as ApiResponse<T>;
  } catch {
    throw new Error(`Avanan API returned non-JSON (${res.status}): ${res.text.slice(0, 200)}`);
  }
}
