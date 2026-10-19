import { describe, expect, it } from "vitest";
import {
  authEnvSchema,
  EnvValidationError,
  parseEnv,
  webhookEnvSchema,
  workerEnvSchema,
} from "./env";

const db = "postgresql://user:pass@localhost:5432/ravi_ai";

describe("env validation", () => {
  it("parses a valid webhook env", () => {
    const env = parseEnv(webhookEnvSchema, {
      DATABASE_URL: db,
      WHATSAPP_VERIFY_TOKEN: "a".repeat(32),
      WHATSAPP_APP_SECRET: "secret",
    });
    expect(env.WHATSAPP_APP_SECRET).toBe("secret");
  });

  it("reports invalid variables by name without echoing values", () => {
    try {
      parseEnv(webhookEnvSchema, { DATABASE_URL: "mysql://nope", WHATSAPP_VERIFY_TOKEN: "short" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const msg = (err as Error).message;
      expect(msg).toContain("DATABASE_URL");
      expect(msg).toContain("WHATSAPP_VERIFY_TOKEN");
      expect(msg).toContain("WHATSAPP_APP_SECRET");
      expect(msg).not.toContain("mysql://nope");
    }
  });

  it("applies safe worker defaults (AI off)", () => {
    const env = parseEnv(workerEnvSchema, { DATABASE_URL: db });
    expect(env.AI_AUTO_REPLY_ENABLED).toBe(false);
    expect(env.AI_PROVIDER).toBe("disabled");
    expect(env.WHATSAPP_GRAPH_API_VERSION).toMatch(/^v\d+\.\d+$/);
  });

  it("defaults auth to closed registration and the local outbox", () => {
    const env = parseEnv(authEnvSchema, {
      BETTER_AUTH_SECRET: "s".repeat(32),
      BETTER_AUTH_URL: "http://localhost:3000",
    });
    expect(env.REGISTRATION_MODE).toBe("closed");
    expect(env.EMAIL_PROVIDER).toBe("outbox");
  });

  it("rejects open registration and insecure production auth config", () => {
    expect(() =>
      parseEnv(authEnvSchema, {
        BETTER_AUTH_SECRET: "s".repeat(32),
        BETTER_AUTH_URL: "http://localhost:3000",
        REGISTRATION_MODE: "open",
      }),
    ).toThrow(/REGISTRATION_MODE/);
    expect(() =>
      parseEnv(authEnvSchema, {
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: "s".repeat(32),
        BETTER_AUTH_URL: "http://app.example.com",
      }),
    ).toThrow(/EMAIL_PROVIDER[\s\S]*https/);
    expect(() =>
      parseEnv(authEnvSchema, {
        BETTER_AUTH_SECRET: "short",
        BETTER_AUTH_URL: "http://localhost:3000",
        EMAIL_PROVIDER: "resend",
      }),
    ).toThrow(/BETTER_AUTH_SECRET[\s\S]*RESEND_API_KEY[\s\S]*EMAIL_FROM/);
  });

  it("refuses auto-reply without a provider or encryption key", () => {
    expect(() =>
      parseEnv(workerEnvSchema, { DATABASE_URL: db, AI_AUTO_REPLY_ENABLED: "true" }),
    ).toThrow(/AI_PROVIDER[\s\S]*ENCRYPTION_KEY/);
  });
});
