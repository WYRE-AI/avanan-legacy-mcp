/**
 * Whitelist / blacklist exceptions.
 * Endpoints: GET|POST /v1.0/exceptions/{excType}, GET|PUT /v1.0/exceptions/{excType}/{excId},
 * POST /v1.0/exceptions/{excType}/delete/{excId}.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { apiRequest } from "../utils/client.js";
import { formatObjectResult, formatPagedResult } from "../utils/format.js";
import { pickDefined } from "../utils/request.js";
import type { CallToolResult, ExceptionEntry } from "../utils/types.js";

const EXC_TYPES = ["whitelist", "blacklist"] as const;

const EXCEPTION_FIELD_KEYS = [
  "senderEmail",
  "senderDomain",
  "senderName",
  "recipient",
  "subject",
  "attachmentMd5",
  "linkDomains",
  "senderIp",
  "senderClientIp",
  "comment",
  "actionNeeded",
  "matchOnlyFuture",
  "quarantineAll",
  "ignoringSpfCheck",
  "senderEmailMatching",
  "senderDomainMatching",
  "senderNameMatching",
  "recipientMatching",
  "subjectMatching",
  "linkDomainMatching",
] as const;

const excTypeProp = {
  excType: { type: "string", enum: [...EXC_TYPES], description: "Exception list: whitelist or blacklist." },
} as const;
const excIdProp = { excId: { type: "string", description: "Exception entity ID." } } as const;

const exceptionFieldProps = {
  senderEmail: { type: "string", description: "Sender email address." },
  senderDomain: { type: "string", description: "Sender domain." },
  senderName: { type: "string", description: "Sender display name." },
  recipient: { type: "string", description: "Recipient email address." },
  subject: { type: "string", description: "Email subject." },
  attachmentMd5: { type: "string", description: "Attachment MD5 hash." },
  linkDomains: { type: "string", description: "Link domain(s) in the email body." },
  senderIp: { type: "string", description: "Sender IP address." },
  senderClientIp: { type: "string", description: "Sender client IP address." },
  comment: { type: "string", description: "Why this exception exists." },
  actionNeeded: { type: "string", description: "Action to apply on match (as accepted by the portal)." },
  matchOnlyFuture: { type: "string", description: "Apply only to future emails." },
  quarantineAll: { type: "string", description: "Quarantine all matches (blacklist)." },
  ignoringSpfCheck: { type: "boolean", description: "Ignore SPF check for this exception." },
  senderEmailMatching: { type: "string", enum: ["matching", "contains"] },
  senderDomainMatching: { type: "string", enum: ["contains", "endswith"] },
  senderNameMatching: { type: "string", enum: ["matching", "contains"] },
  recipientMatching: { type: "string", enum: ["matching", "contains"] },
  subjectMatching: { type: "string", enum: ["matching", "contains"] },
  linkDomainMatching: { type: "string", enum: ["matching", "contains"] },
} as const;

export const exceptionTools: Tool[] = [
  {
    name: "avanan_list_exceptions",
    description: "List whitelist or blacklist exception entries.",
    inputSchema: { type: "object", properties: excTypeProp, required: ["excType"], additionalProperties: false },
  },
  {
    name: "avanan_get_exception",
    description: "Get one whitelist or blacklist entry by its entity ID.",
    inputSchema: {
      type: "object",
      properties: { ...excTypeProp, ...excIdProp },
      required: ["excType", "excId"],
      additionalProperties: false,
    },
  },
  {
    name: "avanan_add_exception",
    description:
      "Add a whitelist or blacklist entry. Provide at least one match field (senderEmail, senderDomain, senderName, recipient, subject, attachmentMd5, linkDomains, senderIp).",
    inputSchema: {
      type: "object",
      properties: { ...excTypeProp, ...exceptionFieldProps },
      required: ["excType"],
      additionalProperties: false,
    },
  },
  {
    name: "avanan_update_exception",
    description: "Update an existing whitelist or blacklist entry by its entity ID.",
    inputSchema: {
      type: "object",
      properties: { ...excTypeProp, ...excIdProp, ...exceptionFieldProps },
      required: ["excType", "excId"],
      additionalProperties: false,
    },
  },
  {
    name: "avanan_delete_exception",
    description:
      "DESTRUCTIVE and irreversible: delete a whitelist or blacklist entry by its entity ID. Confirm with the user before invoking.",
    annotations: {
      title: "Delete exception (irreversible)",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: "object",
      properties: { ...excTypeProp, ...excIdProp },
      required: ["excType", "excId"],
      additionalProperties: false,
    },
  },
];

export async function handleExceptionTool(
  name: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const excType = String(args.excType);
  if (!(EXC_TYPES as readonly string[]).includes(excType)) {
    return { content: [{ type: "text", text: `excType must be one of: ${EXC_TYPES.join(", ")}` }], isError: true };
  }
  const excId = args.excId === undefined ? "" : encodeURIComponent(String(args.excId));

  switch (name) {
    case "avanan_list_exceptions": {
      const res = await apiRequest<ExceptionEntry[]>(`/exceptions/${excType}`);
      const summary = (res.responseData ?? []).map((e) =>
        pickDefined(e, ["entityId", "senderEmail", "senderDomain", "senderName", "recipient", "subject", "attachmentMd5", "comment", "addedBy", "updateTime"])
      );
      return formatPagedResult(res, summary, `${excType} exception`);
    }
    case "avanan_get_exception": {
      const res = await apiRequest<ExceptionEntry>(`/exceptions/${excType}/${excId}`);
      return formatObjectResult(res, "Exception");
    }
    case "avanan_add_exception": {
      const res = await apiRequest<ExceptionEntry>(`/exceptions/${excType}`, {
        method: "POST",
        body: { requestData: pickDefined(args, EXCEPTION_FIELD_KEYS) },
      });
      return formatObjectResult(res, `Added ${excType} exception`);
    }
    case "avanan_update_exception": {
      const res = await apiRequest<ExceptionEntry>(`/exceptions/${excType}/${excId}`, {
        method: "PUT",
        body: { requestData: pickDefined(args, EXCEPTION_FIELD_KEYS) },
      });
      return formatObjectResult(res, "Updated exception");
    }
    case "avanan_delete_exception": {
      await apiRequest(`/exceptions/${excType}/delete/${excId}`, { method: "POST" });
      return { content: [{ type: "text", text: `Exception ${args.excId} deleted from ${excType}.` }] };
    }
    default:
      return { content: [{ type: "text", text: `Unknown exception tool: ${name}` }], isError: true };
  }
}
