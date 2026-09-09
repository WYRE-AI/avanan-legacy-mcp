// SmartAPI auth + signing contract, pinned against the live API on 2026-09-09.
//
// Verified live behavior that the docs get wrong or leave out:
//   - x-av-sig = sha256(base64(reqId + appId + date [+ path?query] + secret)), hex
//   - x-av-date must NOT carry a trailing "Z" (the documented ".000Z" form 500s)
//   - GET /v1.0/auth returns the raw JWT as the body (not JSON), valid 1h
//   - the auth request signs without the path; every data request signs with it

import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { httpRequest } from "../src/utils/transport.js";
import {
  apiRequest,
  clearTokenCache,
  formatAvananDate,
  getCredentials,
  signRequest,
} from "../src/utils/client.js";
import { credentialStore, extractCredentialsFromHeaders } from "../src/utils/credential-store.js";

vi.mock("../src/utils/transport.js", () => ({ httpRequest: vi.fn() }));
const transport = vi.mocked(httpRequest);

const CLIENT_ID = "app-1";
const CLIENT_SECRET = "sec-1";

function fakeJwt(expiresInSeconds: number): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  return `${b64({ alg: "RS256" })}.${b64({ sub: CLIENT_ID, exp })}.sig`;
}

const expectedSig = (parts: string[]) =>
  createHash("sha256").update(Buffer.from(parts.join(""), "utf8").toString("base64")).digest("hex");

function okEnvelope(data: unknown = []) {
  return {
    status: 200,
    text: JSON.stringify({
      responseEnvelope: { requestId: "r", responseCode: 200, responseText: "" },
      responseData: data,
    }),
  };
}

/** Queue an auth response followed by a data response. */
function primeAuthThenData(token = fakeJwt(3600), data = okEnvelope()) {
  transport.mockResolvedValueOnce({ status: 200, text: token }).mockResolvedValueOnce(data);
}

describe("signRequest", () => {
  it("reproduces the worked example from the Avanan MSP SmartAPI guide", () => {
    const sig = signRequest({
      reqId: "d290f1ee-6c54-4b01-90e6",
      appId: "US:myapp29",
      date: "2021-04-10T00:00:00.000Z",
      secret: "my_avanan_secret",
    });
    expect(sig).toBe("2462b23346ab0642b65d7d094aca5fb4c29fd96d0468deceae2704d258e81497");
  });

  it("omits the request string for the auth handshake", () => {
    const sig = signRequest({ reqId: "rid-1", appId: "app-1", date: "2026-01-01T00:00:00.000", secret: "sec-1" });
    expect(sig).toBe("ed3d93d47a11ee143d76ae823bccf17ddaafacd622a5e5d52a68b4b3f52761fd");
  });

  it("includes path and query between the date and the secret for data requests", () => {
    const sig = signRequest({
      reqId: "rid-1",
      appId: "app-1",
      date: "2026-01-01T00:00:00.000",
      requestString: "/v1.0/msp/usage?year=2026&month=8",
      secret: "sec-1",
    });
    expect(sig).toBe("c97db7dc303c0b8d83705663d48ccd7f7d210b0d8b29b8e89dffc3393514b07f");
  });
});

describe("formatAvananDate", () => {
  it("emits ISO-8601 UTC with milliseconds and no trailing Z", () => {
    expect(formatAvananDate(new Date("2026-09-09T16:49:12.123Z"))).toBe("2026-09-09T16:49:12.123");
  });
});

describe("getCredentials", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("reads AVANAN_CLIENT_ID / AVANAN_CLIENT_SECRET / AVANAN_REGION", () => {
    process.env.AVANAN_CLIENT_ID = "id";
    process.env.AVANAN_CLIENT_SECRET = "secret";
    process.env.AVANAN_REGION = "EU";
    expect(getCredentials()).toEqual({ clientId: "id", clientSecret: "secret", region: "eu" });
  });

  it("returns null when either credential is missing", () => {
    delete process.env.AVANAN_CLIENT_ID;
    delete process.env.AVANAN_CLIENT_SECRET;
    expect(getCredentials()).toBeNull();
  });

  it("prefers per-request credentials from the store", () => {
    process.env.AVANAN_CLIENT_ID = "env-id";
    process.env.AVANAN_CLIENT_SECRET = "env-secret";
    const creds = credentialStore.run(
      { clientId: "req-id", clientSecret: "req-secret", region: "ca" },
      () => getCredentials()
    );
    expect(creds).toEqual({ clientId: "req-id", clientSecret: "req-secret", region: "ca" });
  });
});

describe("extractCredentialsFromHeaders", () => {
  it("maps X-Avanan-Client-Id / X-Avanan-Client-Secret / X-Avanan-Region", () => {
    expect(
      extractCredentialsFromHeaders({
        "x-avanan-client-id": "id",
        "x-avanan-client-secret": "secret",
        "x-avanan-region": "EUW2",
      })
    ).toEqual({ clientId: "id", clientSecret: "secret", region: "euw2" });
  });

  it("returns null without both credentials and drops unknown regions", () => {
    expect(extractCredentialsFromHeaders({ "x-avanan-client-id": "id" })).toBeNull();
    expect(
      extractCredentialsFromHeaders({
        "x-avanan-client-id": "id",
        "x-avanan-client-secret": "s",
        "x-avanan-region": "mars",
      })
    ).toEqual({ clientId: "id", clientSecret: "s", region: undefined });
  });
});

describe("apiRequest", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    transport.mockReset();
    clearTokenCache();
    process.env.AVANAN_CLIENT_ID = CLIENT_ID;
    process.env.AVANAN_CLIENT_SECRET = CLIENT_SECRET;
    delete process.env.AVANAN_REGION;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("throws a clear error when no credentials are configured", async () => {
    delete process.env.AVANAN_CLIENT_ID;
    await expect(apiRequest("/msp/tenants")).rejects.toThrow(/AVANAN_CLIENT_ID and AVANAN_CLIENT_SECRET/);
    expect(transport).not.toHaveBeenCalled();
  });

  it("performs the auth handshake before the first data request", async () => {
    primeAuthThenData();
    await apiRequest("/msp/tenants");

    const auth = transport.mock.calls[0][0];
    expect(auth.method).toBe("GET");
    expect(auth.url).toBe("https://smart-api-production-1-us.avanan.net/v1.0/auth");
    expect(auth.body).toBeUndefined();
    expect(auth.headers["x-av-app-id"]).toBe(CLIENT_ID);
    expect(auth.headers["x-av-token"]).toBe("");
    expect(auth.headers["x-av-date"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(auth.headers["x-av-sig"]).toBe(
      expectedSig([auth.headers["x-av-req-id"], CLIENT_ID, auth.headers["x-av-date"], CLIENT_SECRET])
    );
  });

  it("signs data requests over path + query and carries the token", async () => {
    const token = fakeJwt(3600);
    primeAuthThenData(token);
    await apiRequest("/msp/usage", { params: { year: 2026, month: 8 } });

    const data = transport.mock.calls[1][0];
    expect(data.url).toBe("https://smart-api-production-1-us.avanan.net/v1.0/msp/usage?year=2026&month=8");
    expect(data.headers["x-av-token"]).toBe(token);
    expect(data.headers["x-av-sig"]).toBe(
      expectedSig([
        data.headers["x-av-req-id"],
        CLIENT_ID,
        data.headers["x-av-date"],
        "/v1.0/msp/usage?year=2026&month=8",
        CLIENT_SECRET,
      ])
    );
  });

  it("reuses a cached token for the same client until it nears expiry", async () => {
    primeAuthThenData();
    await apiRequest("/msp/tenants");
    transport.mockResolvedValueOnce(okEnvelope());
    await apiRequest("/msp/licenses");

    expect(transport).toHaveBeenCalledTimes(3);
    expect(transport.mock.calls.filter(([c]) => c.url.endsWith("/v1.0/auth"))).toHaveLength(1);
  });

  it("re-authenticates when the cached token is within the expiry buffer", async () => {
    primeAuthThenData(fakeJwt(30));
    await apiRequest("/msp/tenants");
    primeAuthThenData(fakeJwt(30));
    await apiRequest("/msp/tenants");

    expect(transport.mock.calls.filter(([c]) => c.url.endsWith("/v1.0/auth"))).toHaveLength(2);
  });

  it("drops the cached token after a 401 so the next call re-authenticates", async () => {
    primeAuthThenData(fakeJwt(3600), { status: 401, text: JSON.stringify({ message: "Unauthorized" }) });
    await expect(apiRequest("/msp/tenants")).rejects.toThrow(/401/);
    primeAuthThenData();
    await apiRequest("/msp/tenants");

    expect(transport.mock.calls.filter(([c]) => c.url.endsWith("/v1.0/auth"))).toHaveLength(2);
  });

  it("sends a JSON body on GET for scrollId-style filters", async () => {
    primeAuthThenData();
    await apiRequest("/msp/tenants", { method: "GET", body: { requestData: { scrollId: "abc" } } });

    const data = transport.mock.calls[1][0];
    expect(data.method).toBe("GET");
    expect(data.body).toBe(JSON.stringify({ requestData: { scrollId: "abc" } }));
    expect(data.headers["content-type"]).toBe("application/json");
  });

  it("routes to the regional base URL, including the newer UK and India regions", async () => {
    process.env.AVANAN_REGION = "euw2";
    primeAuthThenData();
    await apiRequest("/msp/tenants");
    expect(transport.mock.calls[0][0].url).toBe("https://smart-api-production-1-euw2.avanan.net/v1.0/auth");

    clearTokenCache();
    process.env.AVANAN_REGION = "aps1";
    primeAuthThenData();
    await apiRequest("/msp/tenants");
    expect(transport.mock.calls[2][0].url).toBe("https://smart-api-production-1-aps1.avanan.net/v1.0/auth");
  });

  it("surfaces the SmartAPI envelope text on error responses", async () => {
    primeAuthThenData(fakeJwt(3600), {
      status: 403,
      text: JSON.stringify({
        responseEnvelope: { requestId: "r", responseCode: 403, responseText: "MSP endpoint, access denied" },
      }),
    });
    await expect(apiRequest("/msp/tenants")).rejects.toThrow("Avanan API error (403): MSP endpoint, access denied");
  });

  it("fails the auth handshake with the server's message", async () => {
    transport.mockResolvedValueOnce({
      status: 400,
      text: '{"message": "Bad Request, could not find app[app-1]"}',
    });
    await expect(apiRequest("/msp/tenants")).rejects.toThrow(/could not find app/);
  });

  it("returns a synthetic success envelope for 204 No Content", async () => {
    primeAuthThenData(fakeJwt(3600), { status: 204, text: "" });
    const res = await apiRequest("/msp/tenants/1", { method: "DELETE" });
    expect(res.responseEnvelope.responseCode).toBe(204);
  });
});
