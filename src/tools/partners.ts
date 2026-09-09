/**
 * Child MSP partner management.
 * Endpoints: /v1.0/msp/msp-partners (list, delete), /v1.0/msp/msppartners-extended (create).
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { apiRequest } from "../utils/client.js";
import { formatPagedResult, formatObjectResult, formatDeleteResult } from "../utils/format.js";
import type { CallToolResult } from "../utils/types.js";

interface MspPartner {
  id: number;
  name: string;
  website?: string;
  country?: string;
  state?: string;
  zip?: string;
}

export const partnerTools: Tool[] = [
  {
    name: "avanan_list_msp_partners",
    description: "List all associated child MSP partners under the current MSP. Returns id and name for each child MSP.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "avanan_create_msp_partner",
    description: "Create a new child MSP partner under the current MSP (msppartners-extended endpoint, July 2026 guide).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the new MSP partner." },
        website: { type: "string", description: "MSP partner website URL." },
        country: {
          type: "string",
          description: "Country the MSP is located in, spelled as in the guide's country list (e.g. 'United States').",
        },
        state: {
          type: "string",
          description: "US state name from the guide's state list. Required only when country is 'United States'.",
        },
        zip: { type: "string", description: "Postal / ZIP code." },
      },
      required: ["name", "website", "country", "zip"],
      additionalProperties: false,
    },
  },
  {
    name: "avanan_delete_msp_partner",
    description: "Delete a child MSP partner by ID. WARNING: all tenants associated with this MSP are also deleted.",
    inputSchema: {
      type: "object",
      properties: {
        msp_id: { type: "integer", description: "ID of the MSP partner to delete." },
      },
      required: ["msp_id"],
      additionalProperties: false,
    },
  },
];

export async function handlePartnerTool(
  name: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  switch (name) {
    case "avanan_list_msp_partners": {
      const res = await apiRequest<MspPartner[]>("/msp/msp-partners");
      return formatPagedResult(res, res.responseData ?? [], "MSP partner");
    }
    case "avanan_create_msp_partner": {
      const { name: partnerName, website, country, state, zip } = args;
      const res = await apiRequest<MspPartner>("/msp/msppartners-extended", {
        method: "POST",
        body: { requestData: { name: partnerName, website, country, state, zip } },
      });
      return formatObjectResult(res, "Created MSP partner");
    }
    case "avanan_delete_msp_partner": {
      await apiRequest(`/msp/msp-partners/${Number(args.msp_id)}`, { method: "DELETE" });
      return formatDeleteResult(`MSP partner ${args.msp_id}`);
    }
    default:
      return { content: [{ type: "text", text: `Unknown partner tool: ${name}` }], isError: true };
  }
}
