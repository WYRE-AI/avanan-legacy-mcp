# Changelog

All notable changes to this project are documented in this file. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Authentication now works against the live SmartAPI.** The 1.x releases shipped a
  best-guess HMAC signature and expected a pre-obtained token, so every request failed.
  The server now performs the documented handshake itself (`GET /v1.0/auth` → one-hour
  JWT, cached per client ID and refreshed a minute before expiry) and signs every request
  with `sha256(base64(reqId + clientId + date + path?query + secret))`, matching Check
  Point's reference `client.py`. Verified live: `GET /v1.0/scopes` and
  `POST /v1.0/event/query` return 200; MSP endpoints reach the backend (a non-MSP key gets
  the backend's `403 MSP endpoint, access denied` rather than the gateway's `Forbidden`).
- `x-av-date` no longer carries a trailing `Z`. The reference guide documents
  `2021-04-10T00:00:00.000Z`, but the API answers HTTP 500 to that form and accepts the
  Z-less ISO timestamp the reference client sends.
- Pagination and `MSPId` filters on list endpoints are sent as a JSON body on `GET`, as the
  API requires. The previous `fetch`-based client would have thrown on a GET with a body.
- API error messages surface the SmartAPI envelope text (or the gateway `message`) instead
  of a bare HTTP status.

### Changed

- **BREAKING:** credentials are now the Client ID / Client Secret pair issued by Avanan
  Support: `AVANAN_CLIENT_ID` + `AVANAN_CLIENT_SECRET` (gateway headers
  `X-Avanan-Client-Id` / `X-Avanan-Client-Secret`). `AVANAN_APP_ID`, `AVANAN_TOKEN`,
  `AVANAN_SECRET` and the matching `X-Avanan-*` headers are gone; the token is obtained by
  the server, not supplied by the operator.
- Region comes from `AVANAN_REGION` / `X-Avanan-Region` only (default `us`). JWT
  region-claim auto-detection was removed: the token has no such claim, and Avanan issues
  one key per region anyway.

### Added

- UK (`euw2`) and India (`aps1`) regions from the July 2026 guide.
- `tests/client.test.ts`: 20 contract tests pinning the live-verified auth handshake,
  signature (including the guide's worked example), date format, token cache and refresh,
  401 invalidation, regional routing, GET-with-body, and error surfacing.

## [1.1.2] - 2026-09-09

### Fixed

- CI pins and checksums the `mcp-publisher` install.

## [1.1.1] - 2026-08-25

### Changed

- Migrated to the WYRE-AI org: npm scope `@wyre-ai`, GHCR namespace `wyre-ai`, registry
  name `io.github.WYRE-AI/avanan-legacy-mcp`.

## [1.1.0] - 2026-07-17

### Added

- **Interactive tenant card via MCP Apps (SEP-1865).** `avanan_get_tenant` results now render as an interactive card in MCP Apps hosts (Claude Desktop/web, and other hosts advertising the `io.modelcontextprotocol/ui` extension) instead of a wall of JSON. The card shows the tenant domain, status, deployment mode, license package, protected-user counts, PoC dates, and add-ons. Non-App hosts are unaffected: the tool's JSON payload is unchanged apart from a new `_card` field.
  - The card is **brand-neutral by default** (system fonts, neutral palette, no baked-in identity — this is a published server) and brandable without rebuilding: `MCP_BRAND_NAME`, `MCP_BRAND_LOGO_URL`, `MCP_BRAND_PRIMARY_COLOR`, `MCP_BRAND_ACCENT_COLOR`, `MCP_BRAND_BG`, and `MCP_BRAND_TEXT` env vars are injected as `window.__BRAND__` at serve time (a gateway can inject the same object per-org). A test pins the default bundle to zero brand identity and zero external font fetches.
  - The renderable tool advertises the UI via `_meta` (`ui/resourceUri`, plus the nested `ui.resourceUri` form) pointing at a new `ui://avanan-legacy/tenant-card.html` resource served as `text/html;profile=mcp-app` — the server now declares the `resources` capability. The card HTML is a self-contained vite single-file bundle embedded at build time (`src/generated/tenant-card-html.ts`, committed), so plain `npm run build` and CI don't need vite.
  - The card is **read-only**: the MSP SmartAPI's only per-tenant writes are create/delete and license assignment, none of which are safe as an in-card action.
  - The card payload builder is best-effort: malformed payloads drop the card without affecting the tool result. 17 new contract tests in `tests/mcp-apps.test.ts` pin the `_meta` advertisement, the `ui://` resource wire shape, brand injection (incl. `<`-escaping and empty-brand byte-identity), and the card normalization.
  - New `npm run build:ui` regenerates the embedded HTML after editing `ui/` (requires the new `vite`, `vite-plugin-singlefile`, and `@modelcontextprotocol/ext-apps` devDependencies).

## [1.0.0] - 2026-05-21

### Added
- Initial MCP server for the Avanan MSP SmartAPI (Jan 2024 reference guide).
- 17 tools across 5 groups:
  - **Child MSPs**: `avanan_list_msp_partners`, `avanan_create_msp_partner`, `avanan_delete_msp_partner`.
  - **MSP users**: `avanan_list_msp_users`, `avanan_get_msp_user`, `avanan_create_msp_user`, `avanan_update_msp_user`, `avanan_delete_msp_user`.
  - **Customer tenants**: `avanan_list_tenants`, `avanan_get_tenant`, `avanan_create_tenant`, `avanan_delete_tenant`.
  - **Licenses**: `avanan_list_licenses`, `avanan_list_addons`, `avanan_assign_license`.
  - **Usage**: `avanan_get_monthly_usage`, `avanan_get_daily_usage`.
- Region auto-detection (env > JWT region claim > `us` default) across US, EU, CA, AP.
- Stdio (local) and HTTP (gateway) transports.
- AsyncLocalStorage credential isolation for concurrent gateway requests.

### Known issues
- The `x-av-sig` signing algorithm is a best-guess (HMAC-SHA256 over a canonical
  string of method, path, date, req-id, app-id, body-hash) because the Avanan
  MSP SmartAPI guide refers to the parent Avanan API Reference Guide for the
  exact algorithm. Replace `signRequest()` in `src/utils/client.ts` once that
  spec is in hand.
