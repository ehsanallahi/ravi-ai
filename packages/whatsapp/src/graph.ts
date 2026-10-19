/**
 * Read-only Graph API helpers used by the connection diagnostic. Only GET requests: nothing here
 * can send a message or change the account.
 */
import { GRAPH_API_BASE, WhatsAppApiError, isRetryable } from "./client";

/** Newest Graph API version per Meta's changelog (checked 2026-10-19). */
export const LATEST_KNOWN_GRAPH_API_VERSION = "v26.0";
/** Oldest version still available on 2026-10-19 (v21.0 is available until 2027-01-21). */
export const OLDEST_AVAILABLE_GRAPH_API_VERSION = "v21.0";

export interface GraphGetParams {
  accessToken: string;
  graphApiVersion: string;
  /** Path below the version, e.g. "123456/phone_numbers". Numeric IDs only. */
  path: string;
  fields?: string[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Removes the token from any text before it can reach logs or the terminal. */
export function redactToken(text: string, accessToken: string): string {
  return accessToken ? text.split(accessToken).join("[REDACTED]") : text;
}

export async function graphGet<T>(params: GraphGetParams): Promise<T> {
  const {
    accessToken,
    graphApiVersion,
    path,
    fields,
    fetchImpl = fetch,
    timeoutMs = 15_000,
  } = params;
  if (!/^v\d+\.\d+$/.test(graphApiVersion)) throw new Error("Invalid Graph API version");
  if (!/^\d+(\/[a-z_]+)?$/.test(path)) throw new Error("Invalid Graph API path");

  const url = new URL(`${GRAPH_API_BASE}/${graphApiVersion}/${path}`);
  if (fields?.length) url.searchParams.set("fields", fields.join(","));

  let response: Response;
  try {
    // Token in the Authorization header, never in the URL (URLs end up in logs).
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new WhatsAppApiError(
      `Graph API request failed: ${redactToken(message, accessToken)}`,
      null,
      null,
      true,
    );
  }

  const json = (await response.json().catch(() => null)) as
    (T & { error?: { message?: string; code?: number; error_subcode?: number } }) | null;
  if (!response.ok || !json || json.error) {
    const code = json?.error?.code ?? null;
    const subcode = json?.error?.error_subcode;
    const message = redactToken(json?.error?.message ?? "unknown error", accessToken);
    throw new WhatsAppApiError(
      `Graph API error ${response.status}${code ? ` (code ${code}${subcode ? `/${subcode}` : ""})` : ""}: ${message}`,
      response.status,
      code,
      isRetryable(response.status, code),
    );
  }
  return json;
}

export interface PhoneNumberInfo {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  code_verification_status?: string;
  name_status?: string;
  platform_type?: string;
  throughput?: { level?: string };
}

export interface BusinessAccountInfo {
  id: string;
  name?: string;
  currency?: string;
  timezone_id?: string;
}

export type DiagnosticStatus = "pass" | "warn" | "fail";

export interface DiagnosticCheck {
  name: string;
  status: DiagnosticStatus;
  detail: string;
}

export interface ConnectionDiagnostic {
  checks: DiagnosticCheck[];
  phoneNumber: PhoneNumberInfo | null;
  businessAccount: BusinessAccountInfo | null;
  ok: boolean;
}

/** "+1 555 123 4567" -> "+1 555 *** **67". Test numbers are not secret, but keep output tidy. */
export function maskPhone(display: string | undefined): string {
  if (!display) return "(none)";
  const digits = display.replace(/\D/g, "");
  if (digits.length <= 6) return "***";
  return `+${digits.slice(0, digits.length - 7)}*****${digits.slice(-2)}`;
}

function versionNumber(v: string): number {
  const [major, minor] = v.slice(1).split(".").map(Number);
  return (major ?? 0) * 1000 + (minor ?? 0);
}

/**
 * Read-only connection check: the token can read the phone number and the WhatsApp Business
 * Account, the phone number belongs to that account, and an app is subscribed to its webhooks.
 */
export async function diagnoseConnection(params: {
  accessToken: string;
  graphApiVersion: string;
  phoneNumberId: string;
  wabaId: string;
  /** Your Meta app ID; when set, the check confirms that this app (not another) is subscribed. */
  appId?: string;
  fetchImpl?: typeof fetch;
}): Promise<ConnectionDiagnostic> {
  const { accessToken, graphApiVersion, phoneNumberId, wabaId, appId, fetchImpl } = params;
  const checks: DiagnosticCheck[] = [];
  const base = { accessToken, graphApiVersion, fetchImpl };
  const fail = (name: string, err: unknown) =>
    checks.push({
      name,
      status: "fail",
      detail: redactToken(err instanceof Error ? err.message : String(err), accessToken),
    });

  const v = versionNumber(graphApiVersion);
  if (v < versionNumber(OLDEST_AVAILABLE_GRAPH_API_VERSION)) {
    checks.push({
      name: "Graph API version",
      status: "fail",
      detail: `${graphApiVersion} is no longer available; use ${LATEST_KNOWN_GRAPH_API_VERSION}`,
    });
  } else {
    checks.push({
      name: "Graph API version",
      status: v < versionNumber(LATEST_KNOWN_GRAPH_API_VERSION) ? "warn" : "pass",
      detail:
        v < versionNumber(LATEST_KNOWN_GRAPH_API_VERSION)
          ? `${graphApiVersion} is supported; the latest is ${LATEST_KNOWN_GRAPH_API_VERSION}`
          : `${graphApiVersion} (latest)`,
    });
  }

  let phoneNumber: PhoneNumberInfo | null = null;
  try {
    phoneNumber = await graphGet<PhoneNumberInfo>({
      ...base,
      path: phoneNumberId,
      fields: [
        "id",
        "display_phone_number",
        "verified_name",
        "quality_rating",
        "code_verification_status",
        "name_status",
        "platform_type",
        "throughput",
      ],
    });
    checks.push({
      name: "Phone number readable",
      status: "pass",
      detail: `${maskPhone(phoneNumber.display_phone_number)} · ${phoneNumber.verified_name ?? "no display name"} · platform ${phoneNumber.platform_type ?? "unknown"} · quality ${phoneNumber.quality_rating ?? "unknown"}`,
    });
    if (phoneNumber.platform_type && phoneNumber.platform_type !== "CLOUD_API") {
      checks.push({
        name: "Phone number on Cloud API",
        status: "fail",
        detail: `platform_type is ${phoneNumber.platform_type}, expected CLOUD_API`,
      });
    }
  } catch (err) {
    fail("Phone number readable", err);
  }

  let businessAccount: BusinessAccountInfo | null = null;
  try {
    businessAccount = await graphGet<BusinessAccountInfo>({
      ...base,
      path: wabaId,
      fields: ["id", "name", "currency", "timezone_id"],
    });
    checks.push({
      name: "WhatsApp Business Account readable",
      status: "pass",
      detail: businessAccount.name ?? "(no name)",
    });
  } catch (err) {
    fail("WhatsApp Business Account readable", err);
  }

  if (businessAccount) {
    try {
      const list = await graphGet<{ data?: { id: string }[] }>({
        ...base,
        path: `${wabaId}/phone_numbers`,
        fields: ["id"],
      });
      const belongs = (list.data ?? []).some((p) => p.id === phoneNumberId);
      checks.push({
        name: "Phone number belongs to the account",
        status: belongs ? "pass" : "fail",
        detail: belongs
          ? `${list.data?.length ?? 0} number(s) on the account`
          : "WHATSAPP_PHONE_NUMBER_ID is not listed under WHATSAPP_BUSINESS_ACCOUNT_ID",
      });
    } catch (err) {
      fail("Phone number belongs to the account", err);
    }

    try {
      const apps = await graphGet<{
        data?: { whatsapp_business_api_data?: { id?: string; name?: string } }[];
      }>({ ...base, path: `${wabaId}/subscribed_apps` });
      const subscribed = (apps.data ?? []).map((a) => ({
        id: a.whatsapp_business_api_data?.id ?? "",
        name: a.whatsapp_business_api_data?.name ?? "app",
      }));
      const names = subscribed.map((a) => a.name).join(", ");
      const ours = appId ? subscribed.some((a) => a.id === appId) : null;
      checks.push({
        name: "App subscribed to account webhooks",
        status: ours ? "pass" : "warn",
        detail: !subscribed.length
          ? "No app is subscribed; configure the webhook in Meta App Dashboard → WhatsApp → Configuration"
          : ours === null
            ? `Subscribed: ${names}. Set WHATSAPP_APP_ID to confirm it is your app`
            : ours
              ? `your app is subscribed (${names})`
              : `your app is NOT subscribed (subscribed: ${names}); configure the webhook in Meta App Dashboard → WhatsApp → Configuration`,
      });
    } catch (err) {
      fail("App subscribed to account webhooks", err);
    }
  }

  return {
    checks,
    phoneNumber,
    businessAccount,
    ok: checks.every((c) => c.status !== "fail"),
  };
}
