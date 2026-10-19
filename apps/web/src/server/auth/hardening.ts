import { randomUUID } from "node:crypto";
import { sha256Hex } from "@ravi/core";
import type { PrismaClient } from "@ravi/db";
import { APIError, createAuthMiddleware } from "better-auth/api";

/**
 * Per-account throttles. Better Auth's built-in limits are keyed by client IP, which a
 * distributed attacker can rotate. These are keyed by the target email instead, so password
 * guessing and reset-email bombing are capped per account no matter how many IPs are used.
 */
export const ACCOUNT_LIMITS = {
  "/sign-in/email": { max: 10, windowMs: 15 * 60_000 },
  "/request-password-reset": { max: 5, windowMs: 60 * 60_000 },
  "/send-verification-email": { max: 5, windowMs: 60 * 60_000 },
} as const satisfies Record<string, { max: number; windowMs: number }>;

/** 2FA verification endpoints. "Trust this device" is disabled: owners and admins must enter a code every sign-in. */
const TWO_FACTOR_VERIFY_PATHS = new Set([
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
  "/two-factor/verify-otp",
]);

/**
 * Atomically counts an attempt in a fixed window that starts at the first attempt. Reuses the
 * RateLimit table with an "acct:" key prefix, which never collides with Better Auth's IP keys.
 * Returns the attempt count within the current window.
 */
export async function countAccountAttempt(
  prisma: PrismaClient,
  bucket: string,
  identifier: string,
  windowMs: number,
  now = Date.now(),
): Promise<number> {
  const key = `acct:${bucket}:${sha256Hex(identifier.trim().toLowerCase())}`;
  const nowBig = BigInt(now);
  const windowStart = BigInt(now - windowMs);
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" (id, key, count, "lastRequest")
    VALUES (${randomUUID()}, ${key}, 1, ${nowBig})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN "RateLimit"."lastRequest" < ${windowStart} THEN 1 ELSE "RateLimit".count + 1 END,
      "lastRequest" = CASE WHEN "RateLimit"."lastRequest" < ${windowStart} THEN ${nowBig} ELSE "RateLimit"."lastRequest" END
    RETURNING count`;
  return Number(rows[0]?.count ?? 0);
}

export function createHardeningHook(prisma: PrismaClient) {
  return createAuthMiddleware(async (ctx) => {
    if (TWO_FACTOR_VERIFY_PATHS.has(ctx.path) && ctx.body?.trustDevice) {
      throw new APIError("BAD_REQUEST", {
        code: "TRUSTED_DEVICES_DISABLED",
        message: "Trusted devices are disabled. Enter a code each time you sign in.",
      });
    }

    const limit = ACCOUNT_LIMITS[ctx.path as keyof typeof ACCOUNT_LIMITS];
    const email = typeof ctx.body?.email === "string" ? ctx.body.email : null;
    if (limit && email) {
      const count = await countAccountAttempt(prisma, ctx.path, email, limit.windowMs);
      if (count > limit.max) {
        throw new APIError("TOO_MANY_REQUESTS", {
          code: "ACCOUNT_RATE_LIMITED",
          message: "Too many attempts for this account. Please wait and try again.",
        });
      }
    }
  });
}

/** Endpoints Ravi AI does not use. Disabling them shrinks the attack surface. */
export const DISABLED_AUTH_PATHS = [
  "/sign-up/email",
  "/sign-in/social",
  "/link-social",
  "/unlink-account",
  "/list-accounts",
  "/account-info",
  "/get-access-token",
  "/refresh-token",
  "/change-email",
  "/delete-user",
  "/delete-user/callback",
  "/update-user",
  "/two-factor/send-otp",
  "/two-factor/verify-otp",
];
