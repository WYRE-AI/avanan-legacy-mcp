/**
 * Customer tenant management.
 * Endpoints under /v1.0/msp/tenants.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { buildTenantCard, TENANT_CARD_META } from "../card.builder.js";
import { apiRequest } from "../utils/client.js";
import { formatPagedResult, formatObjectResult, formatDeleteResult } from "../utils/format.js";
import { listRequestOptions } from "../utils/request.js";
import type { CallToolResult } from "../utils/types.js";

interface Tenant {
  id: number;
  domain: string;
  deploymentMode: string;
  pocDateStart?: string;
  pocDateExpiration?: string;
  users: number;
  status: { statusCode: string; description: string };
  package: { id: number; codeName: string; displayName: string } | null;
  addons: Array<{ id: number; name: string }>;
  maxLicensedUsers: number | null;
}

export const tenantTools: Tool[] = [
  {
    name: "avanan_list_tenants",
    description: "List all customer tenants associated with the current MSP. Each tenant entry includes domain, deployment mode, user counts, status, license package and add-ons.",
    inputSchema: {
      type: "object",
      properties: {
        scrollId: { type: "string", description: "Pagination scroll ID from a previous response." },
        MSPId: { type: "integer", description: "Parent MSPs only: restrict to the tenants of this child MSP." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "avanan_get_tenant",
    description: "Get details of a single customer tenant by ID, including license, PoC/paid dates, user count, and expiration.",
    // MCP Apps (SEP-1865): results render as an interactive tenant card in
    // App-capable hosts (see src/card.builder.ts).
    _meta: TENANT_CARD_META,
    inputSchema: {
      type: "object",
      properties: { tenant_id: { type: "integer", description: "Avanan tenant ID." } },
      required: ["tenant_id"],
      additionalProperties: false,
    },
  },
  {
    name: "avanan_create_tenant",
    description: "Create a new customer tenant under the current MSP.",
    inputSchema: {
      type: "object",
      properties: {
        adminEmail: { type: "string", description: "Tenant administrator email." },
        tenantName: { type: "string", description: "Tenant name (used in the customer portal domain)." },
        adminName: { type: "string", description: "Tenant administrator's first and last name." },
        phone: { type: "string", description: "Tenant administrator phone number (10 digits)." },
        companyName: { type: "string", description: "Name of the company associated with the tenant." },
        tenantRegion: {
          type: "string",
          enum: ["us", "eu", "ca"],
          description: "Country code for tenant creation region (lowercase).",
        },
        MSPId: { type: "integer", description: "Parent MSPs only: create the tenant under this child MSP." },
      },
      required: ["adminEmail", "tenantName", "adminName", "phone", "companyName", "tenantRegion"],
      additionalProperties: false,
    },
  },
  {
    name: "avanan_delete_tenant",
    description: "Delete a customer tenant by ID. WARNING: this deletes the tenant and all its data.",
    inputSchema: {
      type: "object",
      properties: { tenant_id: { type: "integer", description: "Avanan tenant ID." } },
      required: ["tenant_id"],
      additionalProperties: false,
    },
  },
];

export async function handleTenantTool(
  name: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  switch (name) {
    case "avanan_list_tenants": {
      const res = await apiRequest<Tenant[]>(
        "/msp/tenants",
        listRequestOptions({ scrollId: args.scrollId, MSPId: args.MSPId })
      );
      return formatPagedResult(res, res.responseData ?? [], "tenant");
    }
    case "avanan_get_tenant": {
      const res = await apiRequest<Tenant>(`/msp/tenants/${Number(args.tenant_id)}`);
      // MCP Apps: attach the normalized card payload the ui:// tenant card
      // renders from. Best-effort — a null card just means no UI surface.
      const card = buildTenantCard(res.responseData);
      if (card && res.responseData) {
        res.responseData = { ...res.responseData, _card: card } as Tenant;
      }
      return formatObjectResult(res, "Tenant");
    }
    case "avanan_create_tenant": {
      const res = await apiRequest<Tenant>("/msp/tenants", {
        method: "POST",
        body: { requestData: args },
      });
      return formatObjectResult(res, "Created tenant");
    }
    case "avanan_delete_tenant": {
      await apiRequest(`/msp/tenants/${Number(args.tenant_id)}`, { method: "DELETE" });
      return formatDeleteResult(`Tenant ${args.tenant_id}`);
    }
    default:
      return { content: [{ type: "text", text: `Unknown tenant tool: ${name}` }], isError: true };
  }
}
