/**
 * Remediation actions: quarantine / restore events or secured entities.
 * Endpoints: POST /v1.0/action/event, POST /v1.0/action/entity, GET /v1.0/task/{taskId}.
 * Actions are asynchronous; each returns a task ID to poll.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { apiRequest } from "../utils/client.js";
import { formatObjectResult } from "../utils/format.js";
import { pickDefined } from "../utils/request.js";
import type { CallToolResult } from "../utils/types.js";

const DESTRUCTIVE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const scopeProp = {
  scope: { type: "string", description: "MSP keys only: the farm:tenant scope the IDs belong to." },
} as const;

const eventIdsProp = {
  eventIds: { type: "array", items: { type: "string" }, minItems: 1, description: "Event IDs." },
} as const;

const entityProps = {
  entityIds: { type: "array", items: { type: "string" }, minItems: 1, description: "Entity IDs." },
  entityType: { type: "string", description: "Entity type (default: email)." },
} as const;

export const actionTools: Tool[] = [
  {
    name: "avanan_quarantine_events",
    description:
      "HIGH IMPACT: quarantine the emails behind one or more security events. Reversible with avanan_restore_events. Returns task IDs. Confirm with the user before invoking.",
    annotations: { title: "Quarantine events (reversible)", ...DESTRUCTIVE },
    inputSchema: {
      type: "object",
      properties: { ...eventIdsProp, ...scopeProp },
      required: ["eventIds"],
      additionalProperties: false,
    },
  },
  {
    name: "avanan_restore_events",
    description: "Restore previously quarantined emails behind one or more security events. Returns task IDs.",
    inputSchema: {
      type: "object",
      properties: { ...eventIdsProp, ...scopeProp },
      required: ["eventIds"],
      additionalProperties: false,
    },
  },
  {
    name: "avanan_quarantine_emails",
    description:
      "HIGH IMPACT: quarantine specific secured entities (emails) by entity ID. Reversible with avanan_restore_emails. Returns task IDs. Confirm with the user before invoking.",
    annotations: { title: "Quarantine emails (reversible)", ...DESTRUCTIVE },
    inputSchema: {
      type: "object",
      properties: { ...entityProps, ...scopeProp },
      required: ["entityIds"],
      additionalProperties: false,
    },
  },
  {
    name: "avanan_restore_emails",
    description: "Restore specific quarantined entities (emails) by entity ID. Returns task IDs.",
    inputSchema: {
      type: "object",
      properties: { ...entityProps, ...scopeProp },
      required: ["entityIds"],
      additionalProperties: false,
    },
  },
  {
    name: "avanan_get_task_status",
    description: "Check the state of a quarantine/restore task by the task ID an action returned.",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string", description: "Task ID." } },
      required: ["taskId"],
      additionalProperties: false,
    },
  },
];

function taskResult(label: string, res: { responseData?: unknown }, count: number): CallToolResult {
  const tasks = Array.isArray(res.responseData) ? res.responseData : res.responseData ? [res.responseData] : [];
  const lines = [
    `${label} initiated for ${count} item${count === 1 ? "" : "s"}. Poll with avanan_get_task_status.`,
    "",
    JSON.stringify(tasks, null, 2),
  ];
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

export async function handleActionTool(
  name: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  switch (name) {
    case "avanan_quarantine_events":
    case "avanan_restore_events": {
      const eventActionName = name === "avanan_quarantine_events" ? "quarantine" : "restore";
      const eventIds = args.eventIds as string[];
      const res = await apiRequest("/action/event", {
        method: "POST",
        body: { requestData: pickDefined({ eventIds, eventActionName, scope: args.scope }, ["eventIds", "eventActionName", "scope"]) },
      });
      return taskResult(eventActionName === "quarantine" ? "Quarantine" : "Restore", res, eventIds.length);
    }
    case "avanan_quarantine_emails":
    case "avanan_restore_emails": {
      const entityActionName = name === "avanan_quarantine_emails" ? "quarantine" : "restore";
      const entityIds = args.entityIds as string[];
      const entityType = args.entityType === undefined ? "email" : String(args.entityType);
      const res = await apiRequest("/action/entity", {
        method: "POST",
        body: {
          requestData: pickDefined(
            { entityIds, entityType, entityActionName, scope: args.scope },
            ["entityIds", "entityType", "entityActionName", "scope"]
          ),
        },
      });
      return taskResult(entityActionName === "quarantine" ? "Quarantine" : "Restore", res, entityIds.length);
    }
    case "avanan_get_task_status": {
      const res = await apiRequest(`/task/${encodeURIComponent(String(args.taskId))}`);
      return formatObjectResult(res, "Task");
    }
    default:
      return { content: [{ type: "text", text: `Unknown action tool: ${name}` }], isError: true };
  }
}
