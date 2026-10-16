import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider } from "../types";
import { AnthropicProvider } from "./anthropic";
import { DisabledProvider, ProviderDisabledError } from "./disabled";

export { AnthropicProvider } from "./anthropic";
export { DisabledProvider, ProviderDisabledError } from "./disabled";

export type ProviderConfig =
  { provider: "disabled" } | { provider: "anthropic"; apiKey?: string; model: string };

export function createProvider(config: ProviderConfig): LLMProvider {
  switch (config.provider) {
    case "anthropic":
      return new AnthropicProvider({ apiKey: config.apiKey, model: config.model });
    case "disabled":
      return new DisabledProvider();
  }
}

/** True for transient failures (rate limits, overload, network) that are worth retrying. */
export function isRetryableProviderError(err: unknown): boolean {
  if (err instanceof ProviderDisabledError) return false;
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (err instanceof Anthropic.APIError) {
    const status = err.status;
    return (
      status === undefined || status === 408 || status === 409 || status === 429 || status >= 500
    );
  }
  return true;
}
