/**
 * Secured entities (emails, files, messages).
 * Endpoints: POST /v1.0/search/query, GET /v1.0/search/entity/{entityId}.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { apiRequest } from "../utils/client.js";
import { formatPagedResult } from "../utils/format.js";
import { pickDefined } from "../utils/request.js";
import type { ApiResponse, CallToolResult, SecuredEntity } from "../utils/types.js";

export const searchTools: Tool[] = [
  {
    name: "avanan_search_emails",
    description:
      "Search secured entities (emails and SaaS objects) by platform and date range, with optional attribute filters (fromEmail, subject, recipients, isQuarantined, attachmentMd5, ...).",
    inputSchema: {
      type: "object",
      properties: {
        saas: {
          type: "string",
          description: "SaaS platform, e.g. office365_emails, google_mail, office365_onedrive, slack, ms_teams.",
        },
        saasEntity: { type: "string", description: "SaaS entity type, e.g. office365_emails_email." },
        startDate: { type: "string", description: "Start of the time frame (ISO 8601)." },
        endDate: { type: "string", description: "End of the time frame (ISO 8601). Defaults to now." },
        filters: {
          type: "array",
          description: "Attribute filters, ANDed together.",
          items: {
            type: "object",
            properties: {
              saasAttrName: { type: "string", description: "Attribute, e.g. fromEmail, subject, recipients, isQuarantined." },
              saasAttrOp: {
                type: "string",
                enum: ["is", "isNot", "contains", "notContains", "startsWith", "isEmpty", "isNotEmpty", "greaterThan", "lessThan"],
              },
              saasAttrValue: { description: "Value to compare against." },
            },
            required: ["saasAttrName", "saasAttrOp"],
          },
        },
        scopes: {
          type: "array",
          items: { type: "string" },
          description: "MSP keys only: restrict to these farm:tenant scopes (see avanan_list_scopes).",
        },
        scrollId: { type: "string", description: "Pagination scroll ID from a previous response." },
      },
      required: ["saas", "startDate"],
      additionalProperties: false,
    },
  },
  {
    name: "avanan_get_email",
    description: "Get full details of one secured entity (email, file, message) by its Avanan entity ID.",
    inputSchema: {
      type: "object",
      properties: { entityId: { type: "string", description: "Avanan entity ID." } },
      required: ["entityId"],
      additionalProperties: false,
    },
  },
];

export async function handleSearchTool(
  name: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  switch (name) {
    case "avanan_search_emails": {
      const requestData: Record<string, unknown> = {
        entityFilter: pickDefined(args, ["saas", "saasEntity", "startDate", "endDate"]),
      };
      if (args.filters !== undefined) requestData.entityExtendedFilter = args.filters;
      Object.assign(requestData, pickDefined(args, ["scopes", "scrollId"]));

      const res = await apiRequest<SecuredEntity[]>("/search/query", {
        method: "POST",
        body: { requestData },
      });
      return formatEntities(res);
    }
    case "avanan_get_email": {
      const res = await apiRequest<SecuredEntity[]>(
        `/search/entity/${encodeURIComponent(String(args.entityId))}`
      );
      return formatEntities(res);
    }
    default:
      return { content: [{ type: "text", text: `Unknown search tool: ${name}` }], isError: true };
  }
}

function formatEntities(res: ApiResponse<SecuredEntity[] | SecuredEntity>): CallToolResult {
  const data = res.responseData;
  const entities = Array.isArray(data) ? data : data ? [data] : [];
  const summary = entities.map((e) => ({
    entityId: e.entityInfo?.entityId,
    saas: e.entityInfo?.saas,
    customerId: e.entityInfo?.customerId,
    entityCreated: e.entityInfo?.entityCreated,
    subject: e.entityPayload?.subject,
    from: e.entityPayload?.fromEmail,
    to: e.entityPayload?.to ?? e.entityPayload?.recipients,
    isQuarantined: e.entityPayload?.isQuarantined,
    isRestored: e.entityPayload?.isRestored,
    verdict: e.entitySecurityResult?.combinedVerdict,
    availableActions: e.entityAvailableActions?.map((a) => a.entityActionName) ?? [],
  }));
  return formatPagedResult(res as ApiResponse<SecuredEntity[]>, summary, "email");
}
