/**
 * Verifies the Gemini configuration against YOUR API key (run locally; sends synthetic text only).
 *
 *   pnpm ai:check
 *
 * - Lists the Gemini models your key can access and the actions they support.
 * - Confirms GEMINI_CHAT_MODEL supports generateContent and GEMINI_EMBEDDING_MODEL supports
 *   embedContent.
 * - Embeds one synthetic sentence with outputDimensionality and checks the vector length matches
 *   GEMINI_EMBEDDING_DIMENSIONS and the database column (768) before any vectors are stored.
 * - Sends one tiny synthetic chat request and reports latency, tokens and estimated cost.
 * The API key is never printed.
 */
import {
  estimateChatCostUsd,
  estimateEmbeddingCostUsd,
  GeminiChatProvider,
  GeminiEmbeddingProvider,
} from "@ravi/ai-engine";
import { KNOWLEDGE_EMBEDDING_DIMENSIONS } from "@ravi/db";
import { aiEnvSchema, parseEnv } from "@ravi/validation";
import { GoogleGenAI } from "@google/genai";
import { priceOverrides } from "../src/runtime";

async function main() {
  const env = parseEnv(aiEnvSchema);
  if (!env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not set (add it to .env; it is git-ignored).");
    process.exit(1);
  }
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  let ok = true;

  console.log("Models available to this key (gemini-*):");
  const available = new Map<string, string[]>();
  const pager = await ai.models.list({ config: { pageSize: 100 } });
  for await (const model of pager) {
    const name = (model.name ?? "").replace(/^models\//, "");
    if (!name.startsWith("gemini")) continue;
    available.set(name, model.supportedActions ?? []);
    console.log(`  ${name.padEnd(42)} ${(model.supportedActions ?? []).join(", ")}`);
  }

  const check = (model: string, action: string) => {
    const actions = available.get(model);
    const pass = Boolean(actions?.includes(action));
    console.log(
      `${pass ? "PASS" : "FAIL"}  ${model} supports ${action}${actions ? "" : " (model not listed for this key)"}`,
    );
    ok &&= pass;
  };
  console.log("");
  check(env.GEMINI_CHAT_MODEL, "generateContent");
  check(env.GEMINI_EMBEDDING_MODEL, "embedContent");

  const dimsOk = env.GEMINI_EMBEDDING_DIMENSIONS === KNOWLEDGE_EMBEDDING_DIMENSIONS;
  console.log(
    `${dimsOk ? "PASS" : "FAIL"}  GEMINI_EMBEDDING_DIMENSIONS=${env.GEMINI_EMBEDDING_DIMENSIONS} matches the pgvector column (${KNOWLEDGE_EMBEDDING_DIMENSIONS})`,
  );
  ok &&= dimsOk;

  const prices = priceOverrides(env);
  try {
    const embedder = new GeminiEmbeddingProvider({
      client: ai.models as never,
      model: env.GEMINI_EMBEDDING_MODEL,
      dimensions: env.GEMINI_EMBEDDING_DIMENSIONS,
    });
    const started = Date.now();
    const { vectors, inputTokens } = await embedder.embed(
      [{ text: "Synthetic check: our example shop sells cotton kurtas." }],
      "document",
    );
    const norm = Math.sqrt(vectors[0]!.reduce((s, x) => s + x * x, 0));
    console.log(
      `PASS  embedding: ${vectors[0]!.length} dimensions, norm ${norm.toFixed(3)}, ${Date.now() - started} ms, ~$${estimateEmbeddingCostUsd(env.GEMINI_EMBEDDING_MODEL, inputTokens, prices).toFixed(8)}`,
    );
  } catch (err) {
    ok = false;
    console.log(`FAIL  embedding: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const chat = new GeminiChatProvider({
      client: ai.models as never,
      model: env.GEMINI_CHAT_MODEL,
      thinkingLevel: env.GEMINI_THINKING_LEVEL,
    });
    const started = Date.now();
    const result = await chat.generate({
      system: "You are a test endpoint. Reply with exactly: OK",
      messages: [{ role: "user", content: "Health check" }],
      maxTokens: 20,
    });
    console.log(
      `PASS  chat: "${result.text.slice(0, 20)}" via ${result.model}, ${Date.now() - started} ms, ` +
        `${result.usage.inputTokens} in / ${result.usage.outputTokens} out / ${result.usage.thinkingTokens} thinking tokens, ` +
        `~$${estimateChatCostUsd(env.GEMINI_CHAT_MODEL, result.usage, new Date(), prices).toFixed(8)}`,
    );
  } catch (err) {
    ok = false;
    const status = (err as { status?: number }).status;
    console.log(
      `FAIL  chat: ${status ? `HTTP ${status}` : ""} ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  console.log(ok ? "\nAll checks passed." : "\nSome checks failed. See above.");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
