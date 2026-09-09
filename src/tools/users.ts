/**
 * MSP user management.
 * Endpoints under /v1.0/msp/users.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { apiRequest } from "../utils/client.js";
import { formatPagedResult, formatObjectResult, formatDeleteResult } from "../utils/format.js";
import { listRequestOptions } from "../utils/request.js";
import type { CallToolResult } from "../utils/types.js";

interface MspUser {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  samlLogin: boolean;
  directLogin: boolean;
  viewPrivateData: boolean;
  sendAlerts: boolean;
  receiveWeeklyReports: boolean;
}

const userBodyProps = {
  firstName: { type: "string", description: "User first name." },
  lastName: { type: "string", description: "User last name." },
  email: { type: "string", description: "User email address." },
  role: {
    type: "string",
    enum: ["admin", "operations", "user", "read-only"],
    description: "User role.",
  },
  directLogin: { type: "boolean", description: "Allow password login to the MSP portal." },
  samlLogin: { type: "boolean", description: "Allow SAML login to the MSP portal." },
  viewPrivateData: { type: "boolean", description: "Allow the user to view private data on customer portals." },
  sendAlerts: { type: "boolean", description: "Send customer tenant alerts to this user." },
  receiveWeeklyReports: { type: "boolean", description: "Send weekly reports from customer tenants to this user." },
} as const;

const userBodyRequired = [
  "firstName",
  "lastName",
  "email",
  "role",
  "directLogin",
  "samlLogin",
  "viewPrivateData",
  "sendAlerts",
  "receiveWeeklyReports",
];

export const userTools: Tool[] = [
  {
    name: "avanan_list_msp_users",
    description: "List all MSP users.",
    inputSchema: {
      type: "object",
      properties: {
        scrollId: { type: "string", description: "Pagination scroll ID from a previous response." },
        MSPId: { type: "integer", description: "Parent MSPs only: restrict to the users of this child MSP." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "avanan_get_msp_user",
    description: "Get a single MSP user by ID.",
    inputSchema: {
      type: "object",
      properties: { user_id: { type: "integer", description: "MSP user ID." } },
      required: ["user_id"],
      additionalProperties: false,
    },
  },
  {
    name: "avanan_create_msp_user",
    description: "Create a new MSP user.",
    inputSchema: {
      type: "object",
      properties: {
        ...userBodyProps,
        MSPId: { type: "integer", description: "Parent MSPs only: create the user under this child MSP." },
      },
      required: userBodyRequired,
      additionalProperties: false,
    },
  },
  {
    name: "avanan_update_msp_user",
    description: "Update an MSP user by ID. All fields are required per the SmartAPI spec.",
    inputSchema: {
      type: "object",
      properties: { user_id: { type: "integer", description: "MSP user ID." }, ...userBodyProps },
      required: ["user_id", ...userBodyRequired],
      additionalProperties: false,
    },
  },
  {
    name: "avanan_delete_msp_user",
    description: "Delete an MSP user by ID.",
    inputSchema: {
      type: "object",
      properties: { user_id: { type: "integer", description: "MSP user ID." } },
      required: ["user_id"],
      additionalProperties: false,
    },
  },
];

export async function handleUserTool(
  name: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  switch (name) {
    case "avanan_list_msp_users": {
      const res = await apiRequest<MspUser[]>(
        "/msp/users",
        listRequestOptions({ scrollId: args.scrollId, MSPId: args.MSPId })
      );
      return formatPagedResult(res, res.responseData ?? [], "MSP user");
    }
    case "avanan_get_msp_user": {
      const res = await apiRequest<MspUser>(`/msp/users/${Number(args.user_id)}`);
      return formatObjectResult(res, "MSP user");
    }
    case "avanan_create_msp_user": {
      const { user_id: _ignore, ...payload } = args;
      const res = await apiRequest<MspUser>("/msp/users", {
        method: "POST",
        body: { requestData: payload },
      });
      return formatObjectResult(res, "Created MSP user");
    }
    case "avanan_update_msp_user": {
      const { user_id, ...payload } = args;
      const res = await apiRequest<MspUser>(`/msp/users/${Number(user_id)}`, {
        method: "PUT",
        body: { requestData: payload },
      });
      return formatObjectResult(res, "Updated MSP user");
    }
    case "avanan_delete_msp_user": {
      await apiRequest(`/msp/users/${Number(args.user_id)}`, { method: "DELETE" });
      return formatDeleteResult(`MSP user ${args.user_id}`);
    }
    default:
      return { content: [{ type: "text", text: `Unknown user tool: ${name}` }], isError: true };
  }
}
