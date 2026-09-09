import type { ApiRequestOptions } from "./client.js";

/**
 * SmartAPI list endpoints take their optional filters (scrollId, and MSPId
 * for parent MSPs) as a JSON body on GET. Build the request options for a
 * list call, sending a body only when at least one filter is set.
 */
export function listRequestOptions(filters: Record<string, unknown>): ApiRequestOptions {
  const requestData = Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined)
  );
  return Object.keys(requestData).length > 0 ? { method: "GET", body: { requestData } } : {};
}
