import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false", "1", "0"])
  .default("false")
  .transform((v) => v === "true" || v === "1");

const postgresUrl = z
  .string({ error: "DATABASE_URL is required" })
  .refine((v) => v.startsWith("postgresql://") || v.startsWith("postgres://"), {
    message: "DATABASE_URL must be a PostgreSQL connection string",
  });

/** Environment needed by the WhatsApp webhook route in apps/web. */
export const webhookEnvSchema = z.object({
  DATABASE_URL: postgresUrl,
  WHATSAPP_VERIFY_TOKEN: z
    .string({ error: "WHATSAPP_VERIFY_TOKEN is required" })
    .min(16, "WHATSAPP_VERIFY_TOKEN must be at least 16 characters (use a random value)"),
  WHATSAPP_APP_SECRET: z.string({ error: "WHATSAPP_APP_SECRET is required" }).min(1),
});
export type WebhookEnv = z.infer<typeof webhookEnvSchema>;

/** Environment for authentication and email in apps/web. */
export const authEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    BETTER_AUTH_SECRET: z
      .string({ error: "BETTER_AUTH_SECRET is required" })
      .min(32, "BETTER_AUTH_SECRET must be at least 32 characters (openssl rand -base64 32)"),
    BETTER_AUTH_URL: z.url({ error: "BETTER_AUTH_URL must be the public base URL of the app" }),
    /**
     * "closed" is the only supported mode: there is no public sign-up. Accounts are created by the
     * owner CLI or by accepting an invitation issued by an Owner or Admin. Any other mode needs an
     * explicit product decision.
     */
    REGISTRATION_MODE: z.literal("closed").default("closed"),
    /**
     * Header(s) carrying the real client IP, used for rate limiting. Your proxy MUST overwrite
     * it (for example, Cloudflare: "cf-connecting-ip"). Comma-separated.
     */
    AUTH_IP_HEADERS: z
      .string()
      .default("x-forwarded-for")
      .transform((v) =>
        v
          .split(",")
          .map((h) => h.trim().toLowerCase())
          .filter(Boolean),
      )
      .pipe(z.array(z.string().regex(/^[a-z0-9-]+$/, "Invalid header name")).min(1)),
    EMAIL_PROVIDER: z.enum(["resend", "outbox"]).default("outbox"),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_PROVIDER === "resend") {
      if (!env.RESEND_API_KEY) {
        ctx.addIssue({
          code: "custom",
          path: ["RESEND_API_KEY"],
          message: "required for EMAIL_PROVIDER=resend",
        });
      }
      if (!env.EMAIL_FROM) {
        ctx.addIssue({
          code: "custom",
          path: ["EMAIL_FROM"],
          message: "required for EMAIL_PROVIDER=resend",
        });
      }
    }
    if (env.NODE_ENV === "production") {
      if (env.EMAIL_PROVIDER !== "resend") {
        ctx.addIssue({
          code: "custom",
          path: ["EMAIL_PROVIDER"],
          message: "production requires EMAIL_PROVIDER=resend (the outbox adapter is local-only)",
        });
      }
      if (!env.BETTER_AUTH_URL.startsWith("https://")) {
        ctx.addIssue({
          code: "custom",
          path: ["BETTER_AUTH_URL"],
          message: "must use https in production",
        });
      }
    }
  });
export type AuthEnv = z.infer<typeof authEnvSchema>;

/** Treats empty strings from .env files ("KEY=") as unset, so defaults apply. */
const emptyAsUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const modelId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9.-]*$/, "Expected a model ID like gemini-3.1-flash-lite");
const optionalPrice = z.preprocess(emptyAsUndefined, z.coerce.number().min(0).max(1000).optional());

/**
 * AI configuration shared by apps/web and apps/worker. Gemini is the only implemented provider;
 * without GEMINI_API_KEY, AI features report "not configured" and never call out.
 */
export const aiEnvShape = {
  AI_PROVIDER: z.preprocess(emptyAsUndefined, z.enum(["disabled", "gemini"]).default("gemini")),
  /** Server-side only. Never exposed to the browser (no NEXT_PUBLIC_ prefix). */
  GEMINI_API_KEY: z.preprocess(emptyAsUndefined, z.string().min(10).optional()),
  GEMINI_CHAT_MODEL: z.preprocess(emptyAsUndefined, modelId.default("gemini-3.1-flash-lite")),
  GEMINI_EMBEDDING_MODEL: z.preprocess(emptyAsUndefined, modelId.default("gemini-embedding-2")),
  GEMINI_EMBEDDING_DIMENSIONS: z.preprocess(
    emptyAsUndefined,
    z.coerce.number().int().min(128).max(3072).default(768),
  ),
  /** Gemini 3.x reasoning depth; "minimal" is the fastest and cheapest. */
  GEMINI_THINKING_LEVEL: z.preprocess(
    emptyAsUndefined,
    z.enum(["minimal", "low", "medium", "high"]).default("minimal"),
  ),
  /** Per-organization monthly AI spend cap (USD). Organizations may set a lower cap. */
  AI_MONTHLY_BUDGET_USD: z.preprocess(
    emptyAsUndefined,
    z.coerce.number().min(0).max(10_000).default(25),
  ),
  /** Per-organization AI request cap per hour (all features). */
  AI_ORG_REQUESTS_PER_HOUR: z.preprocess(
    emptyAsUndefined,
    z.coerce.number().int().min(1).max(100_000).default(200),
  ),
  AI_AUTO_REPLY_ENABLED: booleanFromString,
  /**
   * Draft mode: Gemini writes a suggested reply for each inbound WhatsApp text message and stores
   * it for human review. Drafts are never sent. Still needs owner consent and budget.
   */
  AI_DRAFT_REPLIES_ENABLED: booleanFromString,
  /** Per-attempt timeout for Gemini requests (ms). */
  GEMINI_TIMEOUT_MS: z.preprocess(
    emptyAsUndefined,
    z.coerce.number().int().min(1000).max(120_000).default(30_000),
  ),
  /** Attempts per Gemini request, including the first (retries only on 408/429/5xx). */
  GEMINI_MAX_ATTEMPTS: z.preprocess(
    emptyAsUndefined,
    z.coerce.number().int().min(1).max(5).default(3),
  ),
  /** Minimum cosine similarity for a knowledge chunk to count as relevant (tune with pnpm ai:eval). */
  AI_RETRIEVAL_MIN_SIMILARITY: z.preprocess(
    emptyAsUndefined,
    z.coerce.number().min(0).max(1).default(0.55),
  ),
  /** Price overrides (USD per 1M tokens) for models missing from the built-in price table. */
  GEMINI_CHAT_PRICE_INPUT_PER_MTOK: optionalPrice,
  GEMINI_CHAT_PRICE_OUTPUT_PER_MTOK: optionalPrice,
  GEMINI_EMBEDDING_PRICE_PER_MTOK: optionalPrice,
};

export const aiEnvSchema = z.object(aiEnvShape);
export type AiEnv = z.infer<typeof aiEnvSchema>;

/** True when AI calls can be made (provider enabled and a key present). */
export function isAiConfigured(env: Pick<AiEnv, "AI_PROVIDER" | "GEMINI_API_KEY">): boolean {
  return env.AI_PROVIDER === "gemini" && Boolean(env.GEMINI_API_KEY);
}

/** Environment for apps/worker. */
export const workerEnvSchema = z
  .object({
    DATABASE_URL: postgresUrl,
    WHATSAPP_GRAPH_API_VERSION: z
      .string()
      .regex(/^v\d+\.\d+$/, "Expected a Graph API version like v24.0")
      .default("v24.0"),
    ENCRYPTION_KEY: z.string().optional(),
    ...aiEnvShape,
    WORKER_ID: z.string().optional(),
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
    WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    WORKER_LOCK_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(10_000)
      .default(5 * 60_000),
  })
  .superRefine((env, ctx) => {
    if (env.AI_AUTO_REPLY_ENABLED && !isAiConfigured(env)) {
      ctx.addIssue({
        code: "custom",
        path: ["AI_PROVIDER"],
        message: "AI_AUTO_REPLY_ENABLED=true requires AI_PROVIDER=gemini and GEMINI_API_KEY",
      });
    }
    if (env.AI_AUTO_REPLY_ENABLED && !env.ENCRYPTION_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["ENCRYPTION_KEY"],
        message: "ENCRYPTION_KEY is required to decrypt WhatsApp access tokens for sending",
      });
    }
  });
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join("\n  - ")}`);
    this.name = "EnvValidationError";
  }
}

/** Parses env and throws a readable error that names variables but never echoes values. */
export function parseEnv<S extends z.ZodType>(
  schema: S,
  source: Record<string, string | undefined> = process.env,
): z.infer<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  return result.data;
}
