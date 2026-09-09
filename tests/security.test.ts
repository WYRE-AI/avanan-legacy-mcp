// Tenant-security tools → SmartAPI request-shape contract, per the Avanan
// SmartAPI Reference Guide (Feb 2024): events, secured entities, exceptions,
// actions, scopes. These endpoints accept both tenant keys and MSP keys.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventTools, handleEventTool } from "../src/tools/events.js";
import { searchTools, handleSearchTool } from "../src/tools/search.js";
import { exceptionTools, handleExceptionTool } from "../src/tools/exceptions.js";
import { actionTools, handleActionTool } from "../src/tools/actions.js";
import { diagnosticTools, handleDiagnosticTool } from "../src/tools/diagnostics.js";
import { apiRequest } from "../src/utils/client.js";

vi.mock("../src/utils/client.js", () => ({ apiRequest: vi.fn() }));
const api = vi.mocked(apiRequest);

const ok = (data: unknown = []) => ({
  responseEnvelope: { requestId: "r", responseCode: 200, responseText: "", recordsNumber: 0 },
  responseData: data,
});

beforeEach(() => {
  api.mockReset();
  api.mockResolvedValue(ok());
});

describe("events", () => {
  it("avanan_query_events posts only the provided filters, including scopes", async () => {
    await handleEventTool("avanan_query_events", {
      eventTypes: ["phishing"],
      eventStates: ["new"],
      startDate: "2026-09-01T00:00:00Z",
      scopes: ["mt-prod-3:wyretechnology"],
      scrollId: "s1",
    });
    expect(api).toHaveBeenCalledWith("/event/query", {
      method: "POST",
      body: {
        requestData: {
          eventTypes: ["phishing"],
          eventStates: ["new"],
          startDate: "2026-09-01T00:00:00Z",
          scopes: ["mt-prod-3:wyretechnology"],
          scrollId: "s1",
        },
      },
    });
  });

  it("avanan_query_events with no filters sends an empty requestData", async () => {
    await handleEventTool("avanan_query_events", {});
    expect(api).toHaveBeenCalledWith("/event/query", { method: "POST", body: { requestData: {} } });
  });

  it("summarizes events with their available actions", async () => {
    api.mockResolvedValueOnce(
      ok([
        {
          eventId: "e1",
          type: "spam",
          state: "remediated",
          severity: "2",
          saas: "office365_emails",
          eventCreated: "2026-09-08T16:53:41Z",
          description: "Spam attempt",
          availableEventActions: [{ actionName: "restore", actionParameter: {} }],
        },
      ])
    );
    const text = (await handleEventTool("avanan_query_events", {})).content[0].text;
    expect(text).toContain('"eventId": "e1"');
    expect(text).toContain('"availableActions": [\n      "restore"\n    ]');
  });

  it("avanan_get_event fetches by encoded id", async () => {
    await handleEventTool("avanan_get_event", { eventId: "a/b" });
    expect(api).toHaveBeenCalledWith("/event/a%2Fb");
  });

  it("registers both event tools", () => {
    expect(eventTools.map((t) => t.name)).toEqual(["avanan_query_events", "avanan_get_event"]);
  });
});

describe("search", () => {
  it("avanan_search_emails builds entityFilter, extended filters, scopes and scrollId", async () => {
    await handleSearchTool("avanan_search_emails", {
      saas: "office365_emails",
      startDate: "2026-09-01T00:00:00Z",
      endDate: "2026-09-09T00:00:00Z",
      filters: [{ saasAttrName: "fromEmail", saasAttrOp: "contains", saasAttrValue: "beehiiv" }],
      scopes: ["mt-prod-3:wyretechnology"],
      scrollId: "s2",
    });
    expect(api).toHaveBeenCalledWith("/search/query", {
      method: "POST",
      body: {
        requestData: {
          entityFilter: {
            saas: "office365_emails",
            startDate: "2026-09-01T00:00:00Z",
            endDate: "2026-09-09T00:00:00Z",
          },
          entityExtendedFilter: [
            { saasAttrName: "fromEmail", saasAttrOp: "contains", saasAttrValue: "beehiiv" },
          ],
          scopes: ["mt-prod-3:wyretechnology"],
          scrollId: "s2",
        },
      },
    });
  });

  it("avanan_get_email fetches the entity by encoded id", async () => {
    await handleSearchTool("avanan_get_email", { entityId: "x y" });
    expect(api).toHaveBeenCalledWith("/search/entity/x%20y");
  });

  it("summarizes entities from entityInfo and entityPayload", async () => {
    api.mockResolvedValueOnce(
      ok([
        {
          entityInfo: { entityId: "ent1", saas: "office365_emails", entityCreated: "2026-09-08" },
          entityPayload: { subject: "Hello", fromEmail: "a@b.c", to: ["d@e.f"], isQuarantined: false },
          entityAvailableActions: [{ entityActionName: "quarantine", entityActionParam: "" }],
        },
      ])
    );
    const text = (await handleSearchTool("avanan_get_email", { entityId: "ent1" })).content[0].text;
    expect(text).toContain('"entityId": "ent1"');
    expect(text).toContain('"subject": "Hello"');
    expect(text).toContain('"quarantine"');
  });

  it("registers both search tools with saas and startDate required", () => {
    const search = searchTools.find((t) => t.name === "avanan_search_emails");
    expect(search?.inputSchema.required).toEqual(["saas", "startDate"]);
    expect(searchTools.map((t) => t.name)).toContain("avanan_get_email");
  });
});

describe("exceptions", () => {
  it("lists, gets, adds, updates and deletes against the excType paths", async () => {
    await handleExceptionTool("avanan_list_exceptions", { excType: "whitelist" });
    expect(api).toHaveBeenLastCalledWith("/exceptions/whitelist");

    await handleExceptionTool("avanan_get_exception", { excType: "blacklist", excId: "id1" });
    expect(api).toHaveBeenLastCalledWith("/exceptions/blacklist/id1");

    await handleExceptionTool("avanan_add_exception", {
      excType: "whitelist",
      senderEmail: "a@b.c",
      comment: "vendor",
      senderEmailMatching: "matching",
    });
    expect(api).toHaveBeenLastCalledWith("/exceptions/whitelist", {
      method: "POST",
      body: { requestData: { senderEmail: "a@b.c", comment: "vendor", senderEmailMatching: "matching" } },
    });

    await handleExceptionTool("avanan_update_exception", {
      excType: "whitelist",
      excId: "id1",
      comment: "updated",
    });
    expect(api).toHaveBeenLastCalledWith("/exceptions/whitelist/id1", {
      method: "PUT",
      body: { requestData: { comment: "updated" } },
    });

    await handleExceptionTool("avanan_delete_exception", { excType: "whitelist", excId: "id1" });
    expect(api).toHaveBeenLastCalledWith("/exceptions/whitelist/delete/id1", { method: "POST" });
  });

  it("marks delete as destructive and requires at least excType on every tool", () => {
    const del = exceptionTools.find((t) => t.name === "avanan_delete_exception");
    expect(del?.annotations?.destructiveHint).toBe(true);
    for (const tool of exceptionTools) expect(tool.inputSchema.required).toContain("excType");
  });
});

describe("actions", () => {
  it("quarantine/restore events post the action name and optional scope", async () => {
    await handleActionTool("avanan_quarantine_events", { eventIds: ["e1"], scope: "mt-prod-3:t" });
    expect(api).toHaveBeenLastCalledWith("/action/event", {
      method: "POST",
      body: { requestData: { eventIds: ["e1"], eventActionName: "quarantine", scope: "mt-prod-3:t" } },
    });

    await handleActionTool("avanan_restore_events", { eventIds: ["e1", "e2"] });
    expect(api).toHaveBeenLastCalledWith("/action/event", {
      method: "POST",
      body: { requestData: { eventIds: ["e1", "e2"], eventActionName: "restore" } },
    });
  });

  it("quarantine/restore emails default entityType to email", async () => {
    await handleActionTool("avanan_quarantine_emails", { entityIds: ["x"] });
    expect(api).toHaveBeenLastCalledWith("/action/entity", {
      method: "POST",
      body: { requestData: { entityIds: ["x"], entityType: "email", entityActionName: "quarantine" } },
    });
    await handleActionTool("avanan_restore_emails", { entityIds: ["x"], entityType: "file" });
    expect(api).toHaveBeenLastCalledWith("/action/entity", {
      method: "POST",
      body: { requestData: { entityIds: ["x"], entityType: "file", entityActionName: "restore" } },
    });
  });

  it("returns task ids for polling and fetches task status", async () => {
    api.mockResolvedValueOnce(ok([{ eventId: "e1", entityId: "n1", taskId: "t1" }]));
    const text = (await handleActionTool("avanan_quarantine_events", { eventIds: ["e1"] })).content[0].text;
    expect(text).toContain("t1");
    expect(text).toContain("avanan_get_task_status");

    await handleActionTool("avanan_get_task_status", { taskId: "t1" });
    expect(api).toHaveBeenLastCalledWith("/task/t1");
  });

  it("flags quarantine tools as destructive but not restore or status", () => {
    const byName = Object.fromEntries(actionTools.map((t) => [t.name, t]));
    expect(byName.avanan_quarantine_events.annotations?.destructiveHint).toBe(true);
    expect(byName.avanan_quarantine_emails.annotations?.destructiveHint).toBe(true);
    expect(byName.avanan_restore_events.annotations?.destructiveHint).toBeFalsy();
    expect(byName.avanan_get_task_status.annotations?.destructiveHint).toBeFalsy();
  });
});

describe("scopes", () => {
  it("avanan_list_scopes lists the farm:tenant scopes the key can query", async () => {
    api.mockResolvedValueOnce(ok(["mt-prod-3:wyretechnology"]));
    const text = (await handleDiagnosticTool("avanan_list_scopes", {})).content[0].text;
    expect(api).toHaveBeenCalledWith("/scopes");
    expect(text).toContain("mt-prod-3:wyretechnology");
    expect(diagnosticTools.map((t) => t.name)).toContain("avanan_list_scopes");
  });
});
