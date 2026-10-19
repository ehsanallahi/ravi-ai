/**
 * Contract tests: run the REAL @google/genai SDK against a local mock of the Gemini REST API.
 * No API key and no network access. These catch SDK behaviour changes that mocked-client unit
 * tests cannot (for example, how arrays are turned into embedding requests).
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { GoogleGenAI } from "@google/genai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SUPPORT_REPLY_SCHEMA } from "./prompt";
import { GeminiChatProvider, GeminiEmbeddingProvider, type GeminiModelsClient } from "./providers";

interface Captured {
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: CapturedBody;
}

/** The parts of Gemini REST request bodies these tests inspect. */
interface CapturedBody {
  requests?: Record<string, unknown>[];
  contents?: { role: string }[];
  systemInstruction?: unknown;
  generationConfig?: Record<string, unknown>;
}

let server: Server;
let models: GeminiModelsClient;
const captured: Captured[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      captured.push({ url: req.url ?? "", headers: req.headers, body });
      res.setHeader("content-type", "application/json");
      if (req.url?.includes(":generateContent")) {
        res.end(
          JSON.stringify({
            candidates: [
              {
                content: { role: "model", parts: [{ text: '{"answer":"ok"}' }] },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 321,
              candidatesTokenCount: 17,
              thoughtsTokenCount: 4,
            },
            modelVersion: "gemini-3.1-flash-lite",
          }),
        );
      } else if (req.url?.includes(":batchEmbedContents")) {
        // One embedding per request, exactly like the real API.
        res.end(
          JSON.stringify({
            embeddings: ((body as CapturedBody).requests ?? []).map((_: unknown, i: number) => ({
              values: new Array(768).fill(0).map((__, j) => (j === i ? 1 : 0)),
            })),
          }),
        );
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  models = new GoogleGenAI({
    apiKey: "contract-test-dummy-key",
    httpOptions: { baseUrl: `http://127.0.0.1:${port}` },
  }).models as unknown as GeminiModelsClient;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("@google/genai SDK contract (local mock server)", () => {
  it("embeds each chunk separately with gemini-embedding-2 (one request per input)", async () => {
    captured.length = 0;
    const embedder = new GeminiEmbeddingProvider({
      client: models,
      model: "gemini-embedding-2",
      dimensions: 768,
    });
    const result = await embedder.embed(
      [{ text: "first chunk", title: "Doc" }, { text: "second chunk" }, { text: "third" }],
      "document",
    );
    expect(result.vectors).toHaveLength(3);
    expect(result.vectors[1]![1]).toBe(1); // vectors map back to inputs in order

    const call = captured.at(-1)!;
    expect(call.url).toContain("/models/gemini-embedding-2:batchEmbedContents");
    expect(call.body.requests).toHaveLength(3);
    expect(call.body.requests![0]).toMatchObject({
      content: { parts: [{ text: "title: Doc | text: first chunk" }] },
      outputDimensionality: 768,
    });
    expect(call.body.requests![0]).not.toHaveProperty("taskType");
    // The key travels in a header, never in the URL.
    expect(call.url).not.toContain("contract-test-dummy-key");
    expect(call.headers["x-goog-api-key"]).toBe("contract-test-dummy-key");
  });

  it("sends system instruction, structured-output schema and thinking level; parses usage", async () => {
    captured.length = 0;
    const chat = new GeminiChatProvider({
      client: models,
      model: "gemini-3.1-flash-lite",
      thinkingLevel: "minimal",
    });
    const result = await chat.generate({
      system: "SYSTEM RULES",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "price?" },
      ],
      responseJsonSchema: SUPPORT_REPLY_SCHEMA,
      maxTokens: 512,
    });
    expect(result).toMatchObject({
      text: '{"answer":"ok"}',
      refused: false,
      model: "gemini-3.1-flash-lite",
      usage: { inputTokens: 321, outputTokens: 17, thinkingTokens: 4 },
    });

    const body = captured.at(-1)!.body;
    expect(captured.at(-1)!.url).toContain("/models/gemini-3.1-flash-lite:generateContent");
    expect(JSON.stringify(body.systemInstruction)).toContain("SYSTEM RULES");
    expect(body.contents!.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(body.generationConfig).toMatchObject({
      maxOutputTokens: 512,
      responseMimeType: "application/json",
      responseJsonSchema: SUPPORT_REPLY_SCHEMA,
    });
    expect(JSON.stringify(body.generationConfig!.thinkingConfig).toLowerCase()).toContain(
      "minimal",
    );
    expect(body.generationConfig).not.toHaveProperty("temperature");
  });
});
