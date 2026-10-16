import type { GenerateResult, LLMProvider } from "../types";

export class ProviderDisabledError extends Error {
  constructor() {
    super("No AI provider is configured (AI_PROVIDER=disabled)");
    this.name = "ProviderDisabledError";
  }
}

/** Fails closed, so a misconfigured deployment can never send AI replies. */
export class DisabledProvider implements LLMProvider {
  readonly name = "disabled";

  async generate(): Promise<GenerateResult> {
    throw new ProviderDisabledError();
  }
}
