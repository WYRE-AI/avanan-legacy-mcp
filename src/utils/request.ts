import type { ApiRequestOptions } from "./client.js";

/** Copy only the listed keys that are actually set. Keeps request bodies free of nulls. */
export function pickDefined(
  source: Record<string, unknown>,
  keys: readonly string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

/**
 * SmartAPI list endpoints take their optional filters (scrollId, and MSPId
 * for parent MSPs) as a JSON body on GET. Build the request options for a
 * list call, sending a body only when at least one filter is set.
 */
export function listRequestOptions(filters: Record<string, unknown>): ApiRequestOptions {
  const requestData = pickDefined(filters, Object.keys(filters));
  return Object.keys(requestData).length > 0 ? { method: "GET", body: { requestData } } : {};
}
