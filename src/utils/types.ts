/**
 * Shared types for the Avanan MSP SmartAPI MCP server.
 * Reference: Avanan MSP SmartAPI Reference Guide (22 July 2026).
 */

export type CallToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/**
 * Credentials for the Avanan MSP SmartAPI: the Client ID / Client Secret pair
 * issued by Avanan Support. The client exchanges them for a one-hour JWT and
 * signs every request with the secret (see utils/client.ts).
 *
 * Avanan issues a separate key per region, so `region` selects the URL base.
 */
export interface AvananCredentials {
  clientId: string;
  clientSecret: string;
  region?: AvananRegion;
}

export type AvananRegion = "us" | "eu" | "ca" | "ap" | "euw2" | "aps1";

/**
 * Regional URL bases per the MSP SmartAPI guide ("Customer Tenant API URL").
 * All API calls go to https://{base}/v1.0/...
 */
export const REGIONAL_BASE_URLS: Record<AvananRegion, string> = {
  us: "https://smart-api-production-1-us.avanan.net",
  eu: "https://smart-api-production-1-eu.avanan.net",
  ca: "https://smart-api-production-1-ca.avanan.net",
  ap: "https://smart-api-production-5-ap.avanan.net",
  euw2: "https://smart-api-production-1-euw2.avanan.net",
  aps1: "https://smart-api-production-1-aps1.avanan.net",
};

export const DEFAULT_REGION: AvananRegion = "us";

/** Normalize a user-supplied region string; unknown values become undefined. */
export function parseRegion(value: string | undefined): AvananRegion | undefined {
  const region = value?.toLowerCase();
  return region && region in REGIONAL_BASE_URLS ? (region as AvananRegion) : undefined;
}

/**
 * Standard Avanan response envelope (camelCase).
 * Note: `responseCode` is sometimes the SmartAPI internal code (0=success)
 * and sometimes mirrors HTTP status (200, 204). Treat HTTP status as truth.
 */
export interface ResponseEnvelope {
  requestId: string;
  responseCode: number;
  responseText: string;
  additionalText?: string;
  recordsNumber?: number;
  totalRecordsNumber?: number;
  scrollId?: string;
}

/**
 * Avanan responses wrap data in `responseData`. Depending on the endpoint,
 * this can be an array (list endpoints) or a single object (get/create/update).
 */
export interface ApiResponse<T = unknown> {
  responseEnvelope: ResponseEnvelope;
  responseData?: T;
}

/* -------------------------------------------------------------------------- */
/* Tenant-security objects (Avanan SmartAPI Reference Guide, Feb 2024)         */
/* -------------------------------------------------------------------------- */

/** Security event from /event/query or /event/{id}. */
export interface SecurityEvent {
  eventId: string;
  customerId?: string;
  saas?: string;
  entityId?: string;
  state?: string;
  type?: string;
  confidenceIndicator?: string;
  eventCreated?: string;
  severity?: string;
  description?: string;
  availableEventActions?: Array<{ actionName: string; actionParameter?: unknown }>;
  [key: string]: unknown;
}

/** Secured entity (email, file, message) from /search/query or /search/entity/{id}. */
export interface SecuredEntity {
  entityInfo?: {
    entityId?: string;
    customerId?: string;
    saas?: string;
    saasEntityType?: string;
    entityCreated?: string;
    [key: string]: unknown;
  };
  entityPayload?: {
    subject?: string;
    fromEmail?: string;
    to?: string[];
    recipients?: string[];
    isQuarantined?: boolean;
    isRestored?: boolean;
    [key: string]: unknown;
  };
  entitySecurityResult?: { combinedVerdict?: unknown; [key: string]: unknown };
  entityAvailableActions?: Array<{ entityActionName: string; entityActionParam?: string }>;
  [key: string]: unknown;
}

/** Whitelist / blacklist entry from /exceptions/{excType}. */
export interface ExceptionEntry {
  entityId?: string;
  senderEmail?: string;
  senderDomain?: string;
  senderName?: string;
  recipient?: string;
  subject?: string;
  attachmentMd5?: string;
  comment?: string;
  addedBy?: string;
  updateTime?: string;
  [key: string]: unknown;
}
