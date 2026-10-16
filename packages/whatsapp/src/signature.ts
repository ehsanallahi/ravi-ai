import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-hub-signature-256";

/**
 * Verifies Meta's `X-Hub-Signature-256: sha256=<hex>` header.
 * `rawBody` must be the exact bytes received. Re-serialised JSON will not match,
 * because Meta escapes non-ASCII characters.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret) return false;
  const [scheme, received] = signatureHeader.trim().split("=", 2);
  if (scheme !== "sha256" || !received || !/^[0-9a-f]{64}$/i.test(received)) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const actual = Buffer.from(received, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Produces a signature header value; useful for tests and local tooling. */
export function signWebhookBody(rawBody: string | Buffer, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}
