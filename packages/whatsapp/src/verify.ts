import { createHash, timingSafeEqual } from "node:crypto";

export interface SubscriptionParams {
  mode: string | null;
  verifyToken: string | null;
  challenge: string | null;
}

export type SubscriptionResult = { ok: true; challenge: string } | { ok: false };

/** Constant-time string comparison that does not leak length differences. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

/**
 * Handles Meta's webhook subscription handshake
 * (GET ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...).
 */
export function verifySubscription(
  params: SubscriptionParams,
  expectedToken: string,
): SubscriptionResult {
  const { mode, verifyToken, challenge } = params;
  if (mode !== "subscribe" || !verifyToken || !challenge || !expectedToken) return { ok: false };
  // Challenge is echoed back as text/plain; restrict it to a sane shape.
  if (challenge.length > 256 || !/^[\w-]+$/.test(challenge)) return { ok: false };
  return safeEqual(verifyToken, expectedToken) ? { ok: true, challenge } : { ok: false };
}

export function subscriptionParamsFromUrl(url: URL): SubscriptionParams {
  return {
    mode: url.searchParams.get("hub.mode"),
    verifyToken: url.searchParams.get("hub.verify_token"),
    challenge: url.searchParams.get("hub.challenge"),
  };
}
