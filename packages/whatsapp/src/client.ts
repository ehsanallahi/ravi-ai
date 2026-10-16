/**
 * Minimal client for the official WhatsApp Cloud API (Graph API).
 * Docs: https://developers.facebook.com/documentation/business-messaging/whatsapp
 */
export const GRAPH_API_BASE = "https://graph.facebook.com";
export const MAX_TEXT_LENGTH = 4096;

export interface SendTextParams {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  body: string;
  graphApiVersion: string;
  replyToMessageId?: string;
  previewUrl?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class WhatsAppApiError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number | null,
    public readonly code: number | null,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "WhatsAppApiError";
  }
}

/** Graph error codes that mean "try again later" rather than "this request is wrong". */
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 80007, 130429, 131016]);

export function isRetryable(httpStatus: number | null, code: number | null): boolean {
  if (httpStatus === null) return true; // network error / timeout
  if (httpStatus === 429 || httpStatus >= 500) return true;
  return code !== null && RETRYABLE_CODES.has(code);
}

export async function sendTextMessage(params: SendTextParams): Promise<{ messageId: string }> {
  const {
    accessToken,
    phoneNumberId,
    to,
    body,
    graphApiVersion,
    replyToMessageId,
    previewUrl = false,
    fetchImpl = fetch,
    timeoutMs = 15_000,
  } = params;

  if (!/^v\d+\.\d+$/.test(graphApiVersion)) throw new Error("Invalid Graph API version");
  if (!/^\d+$/.test(phoneNumberId)) throw new Error("Invalid phone number ID");
  if (!body.trim()) throw new Error("Message body is empty");
  if (body.length > MAX_TEXT_LENGTH) throw new Error("Message body exceeds 4096 characters");

  const payload: Record<string, unknown> = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body, preview_url: previewUrl },
  };
  if (replyToMessageId) payload.context = { message_id: replyToMessageId };

  let response: Response;
  try {
    response = await fetchImpl(`${GRAPH_API_BASE}/${graphApiVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new WhatsAppApiError(
      `WhatsApp API request failed: ${err instanceof Error ? err.message : String(err)}`,
      null,
      null,
      true,
    );
  }

  const json = (await response.json().catch(() => null)) as {
    messages?: { id?: string }[];
    error?: { message?: string; code?: number };
  } | null;

  if (!response.ok) {
    const code = json?.error?.code ?? null;
    throw new WhatsAppApiError(
      `WhatsApp API error ${response.status}${code ? ` (code ${code})` : ""}: ${
        json?.error?.message ?? "unknown error"
      }`,
      response.status,
      code,
      isRetryable(response.status, code),
    );
  }

  const messageId = json?.messages?.[0]?.id;
  if (!messageId) {
    throw new WhatsAppApiError(
      "WhatsApp API response did not include a message id",
      200,
      null,
      false,
    );
  }
  return { messageId };
}
