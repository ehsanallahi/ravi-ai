import { type Logger, sha256Hex } from "@ravi/core";
import { webhookPayloadSchema } from "@ravi/validation";
import {
  SIGNATURE_HEADER,
  subscriptionParamsFromUrl,
  verifySubscription,
  verifyWebhookSignature,
} from "@ravi/whatsapp";

export const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

export interface WebhookConfig {
  verifyToken: string;
  appSecret: string;
}

export interface WebhookDeps {
  /** Returns null when the server is not configured; the handler then responds 503. */
  getConfig(): WebhookConfig | null;
  /** Durably stores the event. Must be idempotent for the same dedupe key. */
  enqueue(event: { dedupeKey: string; payload: unknown }): Promise<void>;
  log: Logger;
}

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

/** GET: Meta's subscription verification handshake. */
export function handleWebhookVerification(url: URL, deps: WebhookDeps): Response {
  const config = deps.getConfig();
  if (!config) return text("Service not configured", 503);

  const result = verifySubscription(subscriptionParamsFromUrl(url), config.verifyToken);
  if (!result.ok) {
    deps.log.warn("webhook verification rejected");
    return text("Forbidden", 403);
  }
  deps.log.info("webhook verification succeeded");
  return text(result.challenge, 200);
}

/** POST: verify the signature on the raw body, then persist for the worker. */
export async function handleWebhookEvent(request: Request, deps: WebhookDeps): Promise<Response> {
  const config = deps.getConfig();
  if (!config) return text("Service not configured", 503);

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_WEBHOOK_BODY_BYTES) return text("Payload too large", 413);

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
    return text("Payload too large", 413);
  }

  if (!verifyWebhookSignature(rawBody, request.headers.get(SIGNATURE_HEADER), config.appSecret)) {
    deps.log.warn("webhook signature rejected");
    return text("Invalid signature", 401);
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    // Authentic but unparseable: acknowledge so Meta does not retry for days.
    deps.log.warn("webhook body is not valid JSON");
    return text("OK", 200);
  }

  const parsed = webhookPayloadSchema.safeParse(json);
  if (!parsed.success) {
    deps.log.warn("webhook payload ignored: unexpected shape", {
      object: (json as { object?: unknown } | null)?.object ?? null,
    });
    return text("OK", 200);
  }

  try {
    await deps.enqueue({ dedupeKey: `wa-webhook:${sha256Hex(rawBody)}`, payload: parsed.data });
  } catch (err) {
    // Not acknowledged → Meta retries delivery, so nothing is lost.
    deps.log.error("failed to persist webhook", {
      error: err instanceof Error ? err.message : String(err),
    });
    return text("Temporarily unavailable", 500);
  }

  return text("OK", 200);
}
