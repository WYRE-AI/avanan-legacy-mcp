/**
 * Per-request credential isolation via AsyncLocalStorage.
 *
 * In gateway (HTTP) mode each inbound request carries its own credential
 * headers. Instead of mutating process.env (shared across all concurrent
 * requests), credentials live in AsyncLocalStorage so each handler sees
 * only its own values.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { IncomingHttpHeaders } from "node:http";
import { parseRegion, type AvananCredentials } from "./types.js";

export type RequestCredentials = AvananCredentials;

export const credentialStore = new AsyncLocalStorage<RequestCredentials>();

export function getRequestCredentials(): RequestCredentials | undefined {
  return credentialStore.getStore();
}

/**
 * Gateway mode: read X-Avanan-Client-Id, X-Avanan-Client-Secret and the
 * optional X-Avanan-Region from the inbound request headers.
 */
export function extractCredentialsFromHeaders(headers: IncomingHttpHeaders): RequestCredentials | null {
  const get = (name: string) => {
    const value = headers[name];
    return Array.isArray(value) ? value[0] : value;
  };

  const clientId = get("x-avanan-client-id");
  const clientSecret = get("x-avanan-client-secret");
  if (!clientId || !clientSecret) return null;

  return { clientId, clientSecret, region: parseRegion(get("x-avanan-region")) };
}
