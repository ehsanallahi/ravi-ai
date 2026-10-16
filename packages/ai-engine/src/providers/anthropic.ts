import Anthropic from "@anthropic-ai/sdk";
import type { GenerateParams, GenerateResult, LLMProvider } from "../types";

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set([
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
]);
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export interface AnthropicProviderOptions {
  /** Defaults to the SDK's own credential resolution (ANTHROPIC_API_KEY, etc.). */
  apiKey?: string;
  model: string;
  /** Short replies suit WhatsApp; customer chat rarely benefits from high effort. */
  effort?: "low" | "medium" | "high";
  client?: Anthropic;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly effort: "low" | "medium" | "high";

  constructor(options: AnthropicProviderOptions) {
    this.client =
      options.client ?? new Anthropic(options.apiKey ? { apiKey: options.apiKey } : undefined);
    this.model = options.model;
    this.effort = options.effort ?? "low";
  }

  async generate({ system, messages, maxTokens = 4096 }: GenerateParams): Promise<GenerateResult> {
    const useFallback = FALLBACK_MODELS.has(this.model);
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      system,
      messages,
      output_config: { effort: this.effort },
      ...(useFallback ? { betas: [FALLBACK_BETA], fallbacks: "default" } : {}),
    } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);

    const text = response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("")
      .trim();

    return {
      text,
      refused: response.stop_reason === "refusal",
      stopReason: response.stop_reason ?? null,
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
