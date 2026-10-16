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

/** Environment for apps/worker. */
export const workerEnvSchema = z
  .object({
    DATABASE_URL: postgresUrl,
    WHATSAPP_GRAPH_API_VERSION: z
      .string()
      .regex(/^v\d+\.\d+$/, "Expected a Graph API version like v24.0")
      .default("v24.0"),
    ENCRYPTION_KEY: z.string().optional(),
    AI_PROVIDER: z.enum(["disabled", "anthropic"]).default("disabled"),
    AI_MODEL: z.string().min(1).default("claude-opus-5-5"),
    AI_AUTO_REPLY_ENABLED: booleanFromString,
    ANTHROPIC_API_KEY: z.string().optional(),
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
    if (env.AI_AUTO_REPLY_ENABLED && env.AI_PROVIDER === "disabled") {
      ctx.addIssue({
        code: "custom",
        path: ["AI_PROVIDER"],
        message: "AI_AUTO_REPLY_ENABLED=true requires AI_PROVIDER to be set",
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
