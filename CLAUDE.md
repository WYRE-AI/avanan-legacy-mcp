# avanan-legacy-mcp

MCP server for the Avanan MSP SmartAPI. Configuration and the verified auth wire format
are in README.md.

## Development

- `npm test` (vitest), `npm run typecheck`, `npm run lint`, `npm run build`.
- `tests/client.test.ts` pins the live-verified auth contract. Do not "correct" the
  `x-av-date` format back to the guide's `.000Z`; the API rejects it.
- Rebuild `src/generated/tenant-card-html.ts` with `npm run build:ui` after editing `ui/`.
- Live checks need an **MSP** API key (`AVANAN_CLIENT_ID` / `AVANAN_CLIENT_SECRET`).
  Never commit one.

## Learnings - 2026-09-09

- The SmartAPI returns HTTP 500 `{"message":"Internal Server Error"}` on every path when
  `x-av-date` ends in `Z`. This looked like a broken signature for a long time; it is the
  date. Send `new Date().toISOString().slice(0, -1)`.
- `x-av-sig` = `sha256(base64(reqId + appId + date [+ path?query] + secret))` hex. The path
  is included on data requests and omitted on `/auth`. Reference implementation:
  https://www.avanan.com/hubfs/MSP/documents/Smart-API-Documentation/parent_msp/client/client.py
- Error triage by shape: `{"message":"Unauthorized"}` = no `x-av-*` headers reached the
  authorizer; `{"message":"Forbidden"}` = signature wrong (usually the path was left out);
  a `responseEnvelope` with `403 MSP endpoint, access denied` = signature fine, the key is a
  customer-tenant key rather than an MSP key.
- The WYRE key tested today (client id `473a…`) has JWT scope `mt-prod-3:wyretechnology`,
  i.e. a tenant key. `/v1.0/scopes` and `/v1.0/event/query` work with it; all `/msp/*`
  tools are blocked until an MSP-level key is generated from the MSP portal.
- List endpoints take `scrollId` / `MSPId` as a JSON body on `GET`. WHATWG `fetch` throws
  on that, hence the small `node:https` wrapper in `src/utils/transport.ts`.
- The `/auth` response body is the raw JWT (Cognito access token), not JSON. It carries
  `exp` (one hour) but no region claim.
- The tenant-security endpoints (`/event/query`, `/search/query`, `/exceptions/*`,
  `/action/*`, `/task/*`, `/scopes`) live on the same host with the same signing and accept
  a customer-tenant key. Verified live 2026-09-09 with the WYRE tenant key: 454 events in
  24h, entity search, exception lists. `/search/query` caps `recordsNumber` at 10000.
- `scopes` (array) goes on `/event/query` and `/search/query`; `scope` (single string) goes
  on `/action/event` and `/action/entity`. Exceptions take no scope field.
- With a new key, run `avanan_test_connection` first. It prints the scopes and whether
  `/msp/*` is reachable, which is the whole diagnosis in one call.
- The guide's "URLs and URL Base" section says `smartapi-production-1-us.avanan.net`
  (no hyphen). That host does not resolve; it is a typo for `smart-api-production-1-us`.
- No Avanan or Check Point secrets exist in cortex-secret as of 2026-09-09, and the
  `cortex-secret` CLI is read-only here (list|get|env|run), so keys can't be stored from
  a session.
- Current spec: 22 July 2026 guide,
  https://sc1.checkpoint.com/documents/Avanan_MSP_API_Reference/CP_Avanan_MSP_API_Reference_Guide.pdf
  (adds `euw2` UK and `aps1` India regions and the `msp/msppartners-extended` create
  endpoint; the old create-partner endpoint was slated for deprecation June 2025).
