/**
 * Security events (phishing, malware, DLP, anomaly, ...).
 * Endpoints: POST /v1.0/event/query, GET /v1.0/event/{eventId}.
 * Works with a customer-tenant key or an MSP key; MSP keys narrow with `scopes`.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { apiRequest } from "../utils/client.js";
import { formatPagedResult } from "../utils/format.js";
import { pickDefined } from "../utils/request.js";
import type { ApiResponse, CallToolResult, SecurityEvent } from "../utils/types.js";

const EVENT_FILTER_KEYS = [
  "eventTypes",
  "eventStates",
  "severities",
  "saas",
  "eventIds",
  "confidenceIndicator",
  "startDate",
  "endDate",
  "description",
  "scopes",
  "scrollId",
] as const;

export const eventTools: Tool[] = [
  {
    name: "avanan_query_events",
    description:
      "Query Avanan security events (phishing, malware, DLP, anomaly, shadow IT, malicious URL). Filter by type, state, severity, SaaS, date range, or description text. Returns each event's available remediation actions.",
    inputSchema: {
      type: "object",
      properties: {
        eventTypes: {
          type: "array",
          items: {
            type: "string",
            enum: ["phishing", "malware", "suspicious malware", "dlp", "anomaly", "shadow_it", "malicious_url_click", "malicious_url", "spam", "alert"],
          },
          description: "Event types to include.",
        },
        eventStates: {
          type: "array",
          items: { type: "string", enum: ["new", "detected", "pending", "remediated", "dismissed", "exception"] },
          description: "Event states to include.",
        },
        severities: {
          type: "array",
          items: { type: "string", enum: ["lowest", "low", "medium", "high", "critical"] },
          description: "Severities to include.",
        },
        saas: {
          type: "array",
          items: {
            type: "string",
            enum: ["office365_emails", "office365_onedrive", "office365_sharepoint", "sharefile", "slack", "ms_teams", "google_mail", "google_drive", "box", "dropbox"],
          },
          description: "SaaS platforms to include.",
        },
        eventIds: { type: "array", items: { type: "string" }, description: "Fetch these specific event IDs." },
        confidenceIndicator: { type: "string", description: "Confidence indicator, e.g. 'malicious'." },
        startDate: { type: "string", description: "Start of the time frame (ISO 8601, e.g. 2026-09-01T00:00:00Z)." },
        endDate: { type: "string", description: "End of the time frame (ISO 8601). Defaults to now." },
        description: { type: "string", description: "Substring to match in the event description." },
        scopes: {
          type: "array",
          items: { type: "string" },
          description: "MSP keys only: restrict to these farm:tenant scopes (see avanan_list_scopes).",
        },
        scrollId: { type: "string", description: "Pagination scroll ID from a previous response." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "avanan_get_event",
    description: "Get full details of one security event by its Avanan event ID.",
    inputSchema: {
      type: "object",
      properties: { eventId: { type: "string", description: "Avanan event ID." } },
      required: ["eventId"],
      additionalProperties: false,
    },
  },
];

export async function handleEventTool(
  name: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  switch (name) {
    case "avanan_query_events": {
      const res = await apiRequest<SecurityEvent[]>("/event/query", {
        method: "POST",
        body: { requestData: pickDefined(args, EVENT_FILTER_KEYS) },
      });
      return formatEvents(res);
    }
    case "avanan_get_event": {
      const res = await apiRequest<SecurityEvent[]>(`/event/${encodeURIComponent(String(args.eventId))}`);
      return formatEvents(res);
    }
    default:
      return { content: [{ type: "text", text: `Unknown event tool: ${name}` }], isError: true };
  }
}

function formatEvents(res: ApiResponse<SecurityEvent[] | SecurityEvent>): CallToolResult {
  const data = res.responseData;
  const events = Array.isArray(data) ? data : data ? [data] : [];
  const summary = events.map((e) => ({
    eventId: e.eventId,
    type: e.type,
    state: e.state,
    severity: e.severity,
    saas: e.saas,
    customerId: e.customerId,
    eventCreated: e.eventCreated,
    description: e.description,
    confidenceIndicator: e.confidenceIndicator,
    availableActions: e.availableEventActions?.map((a) => a.actionName) ?? [],
  }));
  return formatPagedResult(res as ApiResponse<SecurityEvent[]>, summary, "event");
}
