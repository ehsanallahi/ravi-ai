import { prisma as defaultPrisma, type PrismaClient } from "@ravi/db";
import { type AuthEnv, authEnvSchema, parseEnv } from "@ravi/validation";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { createEmailSender, type EmailSender } from "../email";
import {
  passwordChangedMessage,
  resetPasswordMessage,
  verifyEmailMessage,
} from "../email/templates";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./constants";
import { createHardeningHook, DISABLED_AUTH_PATHS } from "./hardening";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface AuthDeps {
  env: AuthEnv;
  email: EmailSender;
  prisma?: PrismaClient;
  /** Lets Server Actions set cookies. Disabled in integration tests (no Next.js runtime). */
  nextJsCookies?: boolean;
}

/**
 * Better Auth handles authentication only (credentials, sessions, verification, TOTP).
 * Organizations, memberships and RBAC are Ravi AI's own (see server/tenancy).
 */
export function createAuth({ env, email, prisma = defaultPrisma, nextJsCookies = true }: AuthDeps) {
  return betterAuth({
    appName: "Ravi AI",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    // Endpoints the app does not use are switched off entirely.
    disabledPaths: DISABLED_AUTH_PATHS,
    // Per-account throttles and "no trusted devices" (see hardening.ts).
    hooks: { before: createHardeningHook(prisma) },
    // CSRF: state-changing requests must come from this origin.
    trustedOrigins: [env.BETTER_AUTH_URL],

    emailAndPassword: {
      enabled: true,
      // Closed registration: accounts are created only by the owner CLI or invitation acceptance.
      disableSignUp: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await email.send(resetPasswordMessage(user.email, url));
      },
      onPasswordReset: async ({ user }) => {
        await email.send(passwordChangedMessage(user.email));
      },
    },

    emailVerification: {
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }) => {
        await email.send(verifyEmailMessage(user.email, url));
      },
    },

    session: {
      expiresIn: SESSION_TTL_SECONDS,
      updateAge: 60 * 60 * 24,
      // Sensitive account actions (e.g. disabling 2FA) need a sign-in within the last 10 minutes.
      freshAge: 60 * 10,
    },

    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/two-factor/verify-totp": { window: 60, max: 5 },
        "/two-factor/verify-backup-code": { window: 60, max: 5 },
        "/two-factor/enable": { window: 60, max: 5 },
        "/request-password-reset": { window: 60 * 5, max: 3 },
        "/reset-password": { window: 60 * 5, max: 5 },
        "/send-verification-email": { window: 60 * 5, max: 3 },
        "/change-password": { window: 60 * 5, max: 5 },
      },
    },

    advanced: {
      // Pinned explicitly: Better Auth skips origin/CSRF checks by default when it detects a
      // test environment. Protection must not depend on NODE_ENV.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      cookiePrefix: "ravi",
      // Client IP for rate limits comes ONLY from this header. The production proxy (load
      // balancer, CDN) must overwrite it; otherwise clients could spoof it to evade IP limits.
      ipAddress: { ipAddressHeaders: env.AUTH_IP_HEADERS },
      useSecureCookies: env.NODE_ENV === "production",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },

    plugins: [
      twoFactor({
        issuer: "Ravi AI",
        backupCodeOptions: { amount: 10, length: 10 },
      }),
      // Must be last: lets Server Actions that call auth.api set cookies.
      ...(nextJsCookies ? [nextCookies()] : []),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | null = null;

/** Lazily created so `next build` does not need auth secrets. */
export function getAuth(): Auth {
  if (!instance) {
    const env = parseEnv(authEnvSchema);
    instance = createAuth({ env, email: createEmailSender(env) });
  }
  return instance;
}

export function getAuthEnv(): AuthEnv {
  return parseEnv(authEnvSchema);
}
