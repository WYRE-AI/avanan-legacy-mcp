# avanan-legacy-mcp

MCP server for the **legacy Avanan SmartAPI** on `smart-api-production-*.avanan.net`:
MSP tenant management plus per-tenant security (events, entities, exceptions, remediation).
Distinct from `avanan-mcp`, which targets the Check Point Infinity Portal HEC API.

Implements the [Avanan MSP SmartAPI Reference Guide (22 July 2026)](https://sc1.checkpoint.com/documents/Avanan_MSP_API_Reference/CP_Avanan_MSP_API_Reference_Guide.pdf)
and the [Avanan SmartAPI Reference Guide (Feb 2024)](https://www.avanan.com/hubfs/MSP/documents/Smart-API-Documentation/master/Avanan_SmartAPI_Reference_Guide.pdf):

| Group | Tools |
| --- | --- |
| Diagnostics | `avanan_test_connection` (auth handshake, key scopes, MSP-access probe; run this first), `avanan_list_scopes` |
| Security events | `avanan_query_events`, `avanan_get_event` |
| Secured entities | `avanan_search_emails`, `avanan_get_email` |
| Exceptions | `avanan_list_exceptions`, `avanan_get_exception`, `avanan_add_exception`, `avanan_update_exception`, `avanan_delete_exception` |
| Remediation | `avanan_quarantine_events`, `avanan_restore_events`, `avanan_quarantine_emails`, `avanan_restore_emails`, `avanan_get_task_status` |
| Child MSPs | `avanan_list_msp_partners`, `avanan_create_msp_partner`, `avanan_delete_msp_partner` |
| MSP users | `avanan_list_msp_users`, `avanan_get_msp_user`, `avanan_create_msp_user`, `avanan_update_msp_user`, `avanan_delete_msp_user` |
| Customer tenants | `avanan_list_tenants`, `avanan_get_tenant`, `avanan_create_tenant`, `avanan_delete_tenant` |
| Licenses | `avanan_list_licenses`, `avanan_list_addons`, `avanan_assign_license` |
| Usage | `avanan_get_monthly_usage`, `avanan_get_daily_usage` |

## Features

- **Interactive tenant card (MCP Apps, SEP-1865)**: `avanan_get_tenant` renders as an
  interactive card in MCP Apps hosts (Claude Desktop/web) showing domain, status,
  deployment mode, license package, protected users, PoC dates, and add-ons. The card is
  read-only, neutral by default, and brandable via `window.__BRAND__` injection or
  `MCP_BRAND_*` env vars (`MCP_BRAND_NAME`, `MCP_BRAND_LOGO_URL`, `MCP_BRAND_PRIMARY_COLOR`,
  `MCP_BRAND_ACCENT_COLOR`, `MCP_BRAND_BG`, `MCP_BRAND_TEXT`). Plain-JSON behavior is
  unchanged in other hosts. Rebuild the embedded card HTML after editing `ui/` with
  `npm run build:ui`.

## Configuration

| Env var | Required | Description |
| --- | --- | --- |
| `AVANAN_CLIENT_ID` | yes | SmartAPI Client ID (sent as `x-av-app-id`). MSP or customer-tenant key; see below. |
| `AVANAN_CLIENT_SECRET` | yes | SmartAPI Client Secret. Only ever used to sign requests; never sent on the wire. |
| `AVANAN_REGION` | no | `us` (default) \| `eu` \| `ca` \| `ap` \| `euw2` \| `aps1`. Avanan issues one key per region. |
| `MCP_TRANSPORT` | no | `stdio` (default) or `http`. |
| `MCP_HTTP_PORT` | no | HTTP transport port (default 8080). |
| `LOG_LEVEL` | no | `debug` \| `info` \| `warn` \| `error` (default `info`). |

In **gateway mode**, credentials are taken per-request from headers:
`X-Avanan-Client-Id`, `X-Avanan-Client-Secret`, optionally `X-Avanan-Region`.

The server performs the token handshake itself: it calls `GET /v1.0/auth`, caches the
one-hour JWT per client ID, and refreshes it a minute before expiry.

> [!IMPORTANT]
> The MSP-management tools need an **MSP** API key. These are not self-service: Check
> Point/Avanan Support issues them on request, through your distributor if you buy Avanan
> through the channel, one per region. A key generated inside a customer tenant
> authenticates successfully, but every `/msp/*` endpoint then answers
> `403 MSP endpoint, access denied`. The security tools (events, entities, exceptions,
> remediation) work with either kind of key. `avanan_test_connection` reports which kind
> you have.

With an MSP key, the security tools cover every managed customer; pass `scopes` (query
and search) or `scope` (actions) with values from `avanan_list_scopes` to target one.

Parent MSPs can scope list and create calls to a child MSP with the optional `MSPId`
argument (`msp_ids` on the usage tools), as in Check Point's reference client.

## Authentication details

The wire format was verified against the live US endpoint in September 2026 and is pinned
by `tests/client.test.ts`. Two details differ from the reference guide:

- `x-av-date` must **not** end in `Z` (`2026-09-09T16:49:12.123`). The documented
  `.000Z` form makes the API return HTTP 500.
- `x-av-sig` is `sha256(base64(reqId + clientId + date + path?query + secret))` as hex.
  The path is omitted on the `/auth` call only, and the `/auth` response body is the raw
  JWT rather than JSON.

Both match Check Point's reference
[`client.py`](https://www.avanan.com/hubfs/MSP/documents/Smart-API-Documentation/parent_msp/client/client.py).

## Build

```bash
npm install
npm run build
npm start
```

## Regional endpoints

| Region | Base |
| --- | --- |
| `us` | `https://smart-api-production-1-us.avanan.net` |
| `eu` | `https://smart-api-production-1-eu.avanan.net` |
| `ca` | `https://smart-api-production-1-ca.avanan.net` |
| `ap` | `https://smart-api-production-5-ap.avanan.net` |
| `euw2` (UK) | `https://smart-api-production-1-euw2.avanan.net` |
| `aps1` (India) | `https://smart-api-production-1-aps1.avanan.net` |

All endpoints sit under `/v1.0/msp/...`.
