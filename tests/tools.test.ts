// Tool → SmartAPI request-shape contract, per the 22 July 2026 MSP SmartAPI
// guide and Check Point's reference client.py (parent-MSP filters).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { handlePartnerTool, partnerTools } from "../src/tools/partners.js";
import { handleTenantTool } from "../src/tools/tenants.js";
import { handleUserTool } from "../src/tools/users.js";
import { handleUsageTool } from "../src/tools/usage.js";
import { diagnosticTools, handleDiagnosticTool } from "../src/tools/diagnostics.js";
import { apiRequest } from "../src/utils/client.js";

vi.mock("../src/utils/client.js", () => ({ apiRequest: vi.fn() }));
const api = vi.mocked(apiRequest);

const ok = (data: unknown = []) => ({
  responseEnvelope: { requestId: "r", responseCode: 200, responseText: "" },
  responseData: data,
});

beforeEach(() => {
  api.mockReset();
  api.mockResolvedValue(ok());
});

describe("avanan_create_msp_partner", () => {
  it("posts to the msppartners-extended endpoint with the 2026 required fields", async () => {
    await handlePartnerTool("avanan_create_msp_partner", {
      name: "ABC MSP",
      website: "https://abc.example",
      country: "United States",
      state: "Tennessee",
      zip: "37402",
    });
    expect(api).toHaveBeenCalledWith("/msp/msppartners-extended", {
      method: "POST",
      body: {
        requestData: {
          name: "ABC MSP",
          website: "https://abc.example",
          country: "United States",
          state: "Tennessee",
          zip: "37402",
        },
      },
    });
  });

  it("requires name, website, country and zip; state is conditional", () => {
    const tool = partnerTools.find((t) => t.name === "avanan_create_msp_partner");
    expect(tool?.inputSchema.required).toEqual(["name", "website", "country", "zip"]);
    expect(tool?.inputSchema.properties).toHaveProperty("state");
  });
});

describe("list filters travel as a JSON body on GET", () => {
  it("avanan_list_tenants sends no body without filters", async () => {
    await handleTenantTool("avanan_list_tenants", {});
    expect(api).toHaveBeenCalledWith("/msp/tenants", {});
  });

  it("avanan_list_tenants forwards scrollId and the parent-MSP MSPId filter", async () => {
    await handleTenantTool("avanan_list_tenants", { scrollId: "s1", MSPId: 15 });
    expect(api).toHaveBeenCalledWith("/msp/tenants", {
      method: "GET",
      body: { requestData: { scrollId: "s1", MSPId: 15 } },
    });
  });

  it("avanan_list_msp_users forwards scrollId and MSPId", async () => {
    await handleUserTool("avanan_list_msp_users", { MSPId: 15 });
    expect(api).toHaveBeenCalledWith("/msp/users", {
      method: "GET",
      body: { requestData: { MSPId: 15 } },
    });
  });
});

describe("usage reports", () => {
  it("monthly usage takes year/month as query, scrollId in the body, msp_ids repeated", async () => {
    await handleUsageTool("avanan_get_monthly_usage", {
      year: 2026,
      month: 8,
      msp_ids: [1, 2],
      scrollId: "s2",
    });
    expect(api).toHaveBeenCalledWith("/msp/usage", {
      params: { year: 2026, month: 8, msp_ids: [1, 2] },
      body: { requestData: { scrollId: "s2" } },
    });
  });

  it("daily usage without optional filters sends only the query", async () => {
    await handleUsageTool("avanan_get_daily_usage", { year: 2026, month: 8, day: 1 });
    expect(api).toHaveBeenCalledWith("/msp/usage/day", {
      params: { year: 2026, month: 8, day: 1, msp_ids: undefined },
    });
  });
});

describe("avanan_test_connection", () => {
  it("is registered with no inputs", () => {
    const tool = diagnosticTools.find((t) => t.name === "avanan_test_connection");
    expect(tool?.inputSchema).toEqual({ type: "object", properties: {}, additionalProperties: false });
  });

  it("reports the key's scopes and a denied MSP probe with the remedy", async () => {
    api.mockResolvedValueOnce(ok(["mt-prod-3:wyretechnology"]));
    api.mockRejectedValueOnce(new Error("Avanan API error (403): MSP endpoint, access denied"));

    const result = await handleDiagnosticTool("avanan_test_connection", {});

    expect(api).toHaveBeenNthCalledWith(1, "/scopes");
    expect(api).toHaveBeenNthCalledWith(2, "/msp/licenses");
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Authentication: OK");
    expect(text).toContain("mt-prod-3:wyretechnology");
    expect(text).toContain("MSP access: DENIED");
    expect(text).toContain("MSP endpoint, access denied");
    expect(text).toMatch(/MSP portal/);
  });

  it("reports MSP access OK when the licenses probe succeeds", async () => {
    api.mockResolvedValueOnce(ok(["msp-scope"]));
    api.mockResolvedValueOnce(ok([{ id: 1 }, { id: 2 }]));

    const text = (await handleDiagnosticTool("avanan_test_connection", {})).content[0].text;
    expect(text).toContain("MSP access: OK");
    expect(text).toContain("2 license package");
  });

  it("propagates authentication failures as errors", async () => {
    api.mockRejectedValueOnce(new Error("Avanan authentication failed (400): could not find app[x]"));
    await expect(handleDiagnosticTool("avanan_test_connection", {})).rejects.toThrow(/authentication failed/);
  });
});
