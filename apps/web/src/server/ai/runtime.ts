import { createLogger } from "@ravi/core";
import { type AiRuntime, createAiRuntime } from "@ravi/knowledge";
import { aiEnvSchema, parseEnv } from "@ravi/validation";

const log = createLogger({ service: "web", component: "ai" });

let cached: { runtime: AiRuntime | null; error: string | null } | null = null;

/**
 * Server-side AI runtime (Gemini). The API key is read from the server environment only and is
 * never sent to the browser. Configuration errors are reported to administrators without
 * exposing values.
 */
export function getAiRuntime(): { runtime: AiRuntime | null; error: string | null } {
  if (cached) return cached;
  try {
    cached = { runtime: createAiRuntime(parseEnv(aiEnvSchema)), error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid AI configuration";
    log.error("AI configuration invalid", { error: message });
    cached = { runtime: null, error: message };
  }
  return cached;
}
