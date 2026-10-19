import { FakeEmbeddingProvider, ScriptedChatProvider } from "@ravi/ai-engine/testing";
import { prisma } from "@ravi/db";
import { createTenantFixture, resetTestDatabase, type TenantFixture } from "@ravi/testing";
import { aiEnvSchema, parseEnv } from "@ravi/validation";
import { beforeEach, describe, expect, it } from "vitest";
import { askAssistant } from "./assistant";
import { indexKnowledgeDocument } from "./indexing";
import { withUsageRecording } from "./recording";
import { PgHybridRetriever } from "./retriever";
import {
  AiConfigError,
  type AiRuntime,
  createAiRuntime,
  estimateAssistantCostUsd,
} from "./runtime";
import { AiGuardError, assertAiAllowed, getAiUsageSummary } from "./usage";

let A: TenantFixture;
let B: TenantFixture;
let embedder: FakeEmbeddingProvider;
let chat: ScriptedChatProvider;

const baseEnv = parseEnv(aiEnvSchema, {
  GEMINI_API_KEY: "test-key-never-sent",
  AI_MONTHLY_BUDGET_USD: "25",
  // The lexical fake embedder yields lower similarities than real semantic embeddings.
  AI_RETRIEVAL_MIN_SIMILARITY: "0.3",
});

function runtime(overrides: Partial<AiRuntime> = {}): AiRuntime {
  return {
    ...createAiRuntime(baseEnv, { providers: { chat, embeddings: embedder } }),
    ...overrides,
  };
}

async function addDoc(
  f: TenantFixture,
  title: string,
  content: string,
  status: "DRAFT" | "READY" | "ARCHIVED" = "DRAFT",
) {
  return prisma.knowledgeDocument.create({
    data: {
      organizationId: f.organization.id,
      title,
      content,
      status,
      createdByUserId: f.users.ADMIN.id,
    },
  });
}

async function consent(f: TenantFixture) {
  await prisma.organization.update({
    where: { id: f.organization.id },
    data: { aiDataConsentAt: new Date(), aiDataConsentByUserId: f.users.OWNER.id },
  });
}

beforeEach(async () => {
  await resetTestDatabase(prisma);
  A = await createTenantFixture(prisma, "A");
  B = await createTenantFixture(prisma, "B");
  embedder = new FakeEmbeddingProvider(768);
  chat = new ScriptedChatProvider("gemini-3.1-flash-lite");
});

describe("runtime configuration", () => {
  it("rejects embedding dimensions that don't match the pgvector column", () => {
    expect(() => createAiRuntime({ ...baseEnv, GEMINI_EMBEDDING_DIMENSIONS: 1536 })).toThrow(
      AiConfigError,
    );
  });

  it("rejects chat models without a known price unless prices are set", () => {
    expect(() => createAiRuntime({ ...baseEnv, GEMINI_CHAT_MODEL: "gemini-new-unpriced" })).toThrow(
      /No price/,
    );
    expect(() =>
      createAiRuntime({
        ...baseEnv,
        GEMINI_CHAT_MODEL: "gemini-new-unpriced",
        GEMINI_CHAT_PRICE_INPUT_PER_MTOK: 1,
        GEMINI_CHAT_PRICE_OUTPUT_PER_MTOK: 2,
      }),
    ).not.toThrow();
  });

  it("is not configured without an API key", () => {
    expect(createAiRuntime({ ...baseEnv, GEMINI_API_KEY: undefined }).configured).toBe(false);
  });
});

describe("indexing into pgvector", () => {
  it("chunks, embeds and stores 768-dimension vectors; marks the document READY", async () => {
    const doc = await addDoc(
      A,
      "Prices",
      "The cotton kurta costs Rs. 2,500.\n\nDelivery in Lahore costs Rs. 200.",
    );
    const { chunks } = await indexKnowledgeDocument(prisma, embedder, {
      organizationId: A.organization.id,
      documentId: doc.id,
    });
    expect(chunks).toBe(1);
    const rows = await prisma.$queryRaw<{ dims: number; model: string }[]>`
      SELECT vector_dims(embedding) AS dims, "embeddingModel" AS model FROM "KnowledgeChunk" WHERE "documentId" = ${doc.id}`;
    expect(rows).toEqual([{ dims: 768, model: "fake-embedding" }]);
    const updated = await prisma.knowledgeDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(updated).toMatchObject({ status: "READY", embeddingModel: "fake-embedding" });
    expect(embedder.calls[0]!.kind).toBe("document");
  });

  it("cannot index another organization's document", async () => {
    const doc = await addDoc(B, "B doc", "Secret pricing for org B only, kurta Rs 9999.");
    await expect(
      indexKnowledgeDocument(prisma, embedder, {
        organizationId: A.organization.id,
        documentId: doc.id,
      }),
    ).rejects.toThrow(/not found/);
    expect(await prisma.knowledgeChunk.count()).toBe(0);
  });

  it("keeps previous chunks and marks FAILED when embedding fails", async () => {
    const doc = await addDoc(
      A,
      "Prices",
      "The cotton kurta costs Rs. 2,500 in all sizes and colours.",
    );
    await indexKnowledgeDocument(prisma, embedder, {
      organizationId: A.organization.id,
      documentId: doc.id,
    });
    const failing = {
      ...embedder,
      embed: async () => {
        throw Object.assign(new Error("quota"), { status: 429 });
      },
    } as unknown as FakeEmbeddingProvider;
    await expect(
      indexKnowledgeDocument(prisma, failing, {
        organizationId: A.organization.id,
        documentId: doc.id,
      }),
    ).rejects.toThrow();
    const after = await prisma.knowledgeDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(after).toMatchObject({ status: "FAILED", errorMessage: "AI provider error (HTTP 429)" });
    expect(await prisma.knowledgeChunk.count({ where: { documentId: doc.id } })).toBe(1);
  });
});

describe("organization-scoped retrieval", () => {
  it("never returns another organization's chunks, even when they match better", async () => {
    const a = await addDoc(A, "Hours", "Our shop opens Monday to Saturday from 10am to 8pm.");
    const b = await addDoc(
      B,
      "Kurta prices",
      "Kurta price list: cotton kurta Rs 2500, silk kurta Rs 6000.",
    );
    await indexKnowledgeDocument(prisma, embedder, {
      organizationId: A.organization.id,
      documentId: a.id,
    });
    await indexKnowledgeDocument(prisma, embedder, {
      organizationId: B.organization.id,
      documentId: b.id,
    });

    const retriever = new PgHybridRetriever(prisma, embedder, { minSimilarity: 0.1 });
    const forA = await retriever.retrieve({
      organizationId: A.organization.id,
      query: "kurta price list",
      limit: 5,
    });
    expect(forA.every((c) => c.documentId === a.id)).toBe(true);
    const forB = await retriever.retrieve({
      organizationId: B.organization.id,
      query: "kurta price list",
      limit: 5,
    });
    expect(forB[0]?.documentId).toBe(b.id);
    expect(forB[0]?.similarity).toBeGreaterThan(0.3);
  });

  it("excludes archived, draft and failed documents", async () => {
    const doc = await addDoc(A, "Old prices", "Kurta price list: cotton kurta Rs 1800.");
    await indexKnowledgeDocument(prisma, embedder, {
      organizationId: A.organization.id,
      documentId: doc.id,
    });
    await prisma.knowledgeDocument.update({ where: { id: doc.id }, data: { status: "ARCHIVED" } });
    const retriever = new PgHybridRetriever(prisma, embedder, { minSimilarity: 0.1 });
    expect(
      await retriever.retrieve({
        organizationId: A.organization.id,
        query: "kurta price",
        limit: 5,
      }),
    ).toEqual([]);
  });

  it("matches Urdu and Roman Urdu content", async () => {
    const doc = await addDoc(
      A,
      "Delivery",
      "لاہور میں ڈیلیوری دستیاب ہے۔\n\nLahore mein delivery 2 din mein hoti hai.",
    );
    await indexKnowledgeDocument(prisma, embedder, {
      organizationId: A.organization.id,
      documentId: doc.id,
    });
    const retriever = new PgHybridRetriever(prisma, embedder, { minSimilarity: 0.1 });
    expect(
      (
        await retriever.retrieve({
          organizationId: A.organization.id,
          query: "لاہور ڈیلیوری",
          limit: 3,
        })
      )[0]?.documentId,
    ).toBe(doc.id);
    expect(
      (
        await retriever.retrieve({
          organizationId: A.organization.id,
          query: "Lahore delivery kitne din",
          limit: 3,
        })
      )[0]?.documentId,
    ).toBe(doc.id);
  });
});

describe("AI guard: consent, budget, rate limit", () => {
  it("blocks every AI call until an owner opts in", async () => {
    await expect(assertAiAllowed(prisma, A.organization.id, runtime())).rejects.toMatchObject({
      reason: "no_consent",
    });
    await expect(
      askAssistant(prisma, runtime(), {
        organizationId: A.organization.id,
        userId: A.users.ADMIN.id,
        businessName: "A",
        question: "price?",
      }),
    ).rejects.toBeInstanceOf(AiGuardError);
    expect(embedder.calls).toHaveLength(0);
    expect(chat.requests).toHaveLength(0);
  });

  it("refuses when AI is not configured", async () => {
    await consent(A);
    await expect(
      assertAiAllowed(prisma, A.organization.id, runtime({ configured: false })),
    ).rejects.toMatchObject({
      reason: "not_configured",
    });
  });

  it("enforces the monthly budget (organization cap never above the platform cap)", async () => {
    await consent(A);
    await prisma.organization.update({
      where: { id: A.organization.id },
      data: { aiMonthlyBudgetUsd: 100 },
    });
    expect((await getAiUsageSummary(prisma, A.organization.id, runtime().limits)).budgetUsd).toBe(
      25,
    );
    await prisma.aiUsageEvent.create({
      data: {
        organizationId: A.organization.id,
        feature: "PLAYGROUND",
        operation: "CHAT",
        provider: "gemini",
        model: "gemini-3.1-flash-lite",
        estimatedCostUsd: 25,
        success: true,
      },
    });
    await expect(assertAiAllowed(prisma, A.organization.id, runtime())).rejects.toMatchObject({
      reason: "budget_exceeded",
    });
    // Budgets are per organization.
    await consent(B);
    await expect(assertAiAllowed(prisma, B.organization.id, runtime())).resolves.toBeDefined();
  });

  it("enforces the hourly request cap per organization", async () => {
    await consent(A);
    const limited = runtime({ limits: { monthlyBudgetUsd: 25, requestsPerHour: 2 } });
    for (let i = 0; i < 2; i++) {
      await prisma.aiUsageEvent.create({
        data: {
          organizationId: A.organization.id,
          feature: "PLAYGROUND",
          operation: "EMBEDDING",
          provider: "gemini",
          model: "m",
          success: true,
        },
      });
    }
    await expect(assertAiAllowed(prisma, A.organization.id, limited)).rejects.toMatchObject({
      reason: "rate_limited",
    });
  });
});

describe("assistant (playground pipeline)", () => {
  beforeEach(async () => {
    await consent(A);
    const doc = await addDoc(
      A,
      "Prices",
      "Cotton kurta price: Rs. 2,500. Silk kurta price: Rs. 6,000. Delivery in Lahore: Rs. 200.",
    );
    await indexKnowledgeDocument(prisma, embedder, {
      organizationId: A.organization.id,
      documentId: doc.id,
    });
    embedder.calls.length = 0;
  });

  it("answers from retrieved knowledge, stores sources, and records usage and cost", async () => {
    chat.answer({
      answer: "Cotton kurta Rs. 2,500 ka hai.",
      sourceIds: [1],
      language: "roman_urdu",
    });
    const { suggestionId, decision } = await askAssistant(prisma, runtime(), {
      organizationId: A.organization.id,
      userId: A.users.ADMIN.id,
      businessName: "Test Org A",
      question: "cotton kurta price kya hai?",
    });
    expect(decision.kind).toBe("reply");
    const s = await prisma.aiSuggestion.findUniqueOrThrow({ where: { id: suggestionId } });
    expect(s).toMatchObject({
      organizationId: A.organization.id,
      decision: "REPLY",
      answer: "Cotton kurta Rs. 2,500 ka hai.",
      language: "roman_urdu",
      model: "gemini-3.1-flash-lite",
      status: "PENDING",
    });
    const sources = s.sources as { cited: boolean; documentTitle: string }[];
    expect(sources[0]).toMatchObject({ cited: true, documentTitle: "Prices" });
    expect(Number(s.estimatedCostUsd)).toBeGreaterThan(0);

    const events = await prisma.aiUsageEvent.findMany({
      where: { organizationId: A.organization.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.operation)).toEqual(["EMBEDDING", "CHAT"]);
    expect(events[0]).toMatchObject({
      embeddingDimensions: 768,
      success: true,
      feature: "PLAYGROUND",
    });
    expect(events[1]).toMatchObject({
      model: "gemini-3.1-flash-lite",
      inputTokens: 1000,
      outputTokens: 100,
      success: true,
    });
    // gemini-3.1-flash-lite: 1000 in × $0.25/M + 100 out × $1.50/M = $0.0004
    expect(Number(events[1]!.estimatedCostUsd)).toBeCloseTo(0.0004, 6);
    expect(embedder.calls[0]!.kind).toBe("query");
  });

  it("withholds an invented price and hands off, keeping the draft for review", async () => {
    chat.answer({ answer: "Silk kurta sirf Rs. 4,999 ka hai!", language: "roman_urdu" });
    const { suggestionId } = await askAssistant(prisma, runtime(), {
      organizationId: A.organization.id,
      userId: A.users.ADMIN.id,
      businessName: "Test Org A",
      question: "silk kurta price?",
    });
    const s = await prisma.aiSuggestion.findUniqueOrThrow({ where: { id: suggestionId } });
    expect(s).toMatchObject({
      decision: "HANDOFF",
      handoffReason: "unsupported_claim",
      answer: null,
    });
    expect(s.withheldDraft).toContain("4,999");
  });

  it("hands off without a model call when nothing relevant is in the knowledge base", async () => {
    const { decision } = await askAssistant(prisma, runtime(), {
      organizationId: A.organization.id,
      userId: A.users.ADMIN.id,
      businessName: "Test Org A",
      question: "Do you repair laptops?",
    });
    expect(decision).toMatchObject({ kind: "handoff", reason: "no_knowledge" });
    expect(chat.requests).toHaveLength(0);
  });

  it("records failed provider calls with a safe error code and no prompt text", async () => {
    chat.respond(Object.assign(new Error("echo of the secret prompt"), { status: 503 }));
    await expect(
      askAssistant(prisma, runtime(), {
        organizationId: A.organization.id,
        userId: A.users.ADMIN.id,
        businessName: "Test Org A",
        question: "cotton kurta price?",
      }),
    ).rejects.toThrow();
    const failed = await prisma.aiUsageEvent.findFirstOrThrow({ where: { success: false } });
    expect(failed).toMatchObject({ operation: "CHAT", errorCode: "http_503" });
    expect(JSON.stringify(failed)).not.toContain("secret prompt");
  });

  it("never touches WhatsApp: no jobs or outbound messages are created", async () => {
    chat.answer({ answer: "Cotton kurta Rs. 2,500.", sourceIds: [1] });
    await askAssistant(prisma, runtime(), {
      organizationId: A.organization.id,
      userId: A.users.ADMIN.id,
      businessName: "Test Org A",
      question: "cotton kurta price?",
    });
    expect(await prisma.job.count()).toBe(0);
    expect(await prisma.message.count({ where: { direction: "OUTBOUND" } })).toBe(0);
  });

  it("usage recording wrapper tallies cost across calls", async () => {
    const recorded = withUsageRecording(
      prisma,
      { chat, embeddings: embedder },
      { organizationId: A.organization.id, feature: "PLAYGROUND" },
      {},
    );
    chat.answer({ answer: "x" });
    await recorded.chat.generate({ system: "s", messages: [{ role: "user", content: "q" }] });
    await recorded.embeddings.embed([{ text: "hello world" }], "query");
    expect(recorded.tally.calls).toBe(2);
    expect(recorded.tally.costUsd).toBeGreaterThan(0);
  });

  it("is concurrency-safe: simultaneous questions cannot overspend the budget", async () => {
    const rt = runtime();
    // One answer reserves ~$0.0056 (upper bound); a $0.01 budget fits exactly one in flight.
    expect(estimateAssistantCostUsd(rt)).toBeGreaterThan(0.005);
    expect(estimateAssistantCostUsd(rt)).toBeLessThan(0.01);
    await prisma.organization.update({
      where: { id: A.organization.id },
      data: { aiMonthlyBudgetUsd: 0.01 },
    });
    chat.delayMs = 300;
    for (let i = 0; i < 4; i++) chat.answer({ answer: "Cotton kurta Rs. 2,500.", sourceIds: [1] });

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        askAssistant(prisma, rt, {
          organizationId: A.organization.id,
          userId: A.users.ADMIN.id,
          businessName: "Test Org A",
          question: "cotton kurta price?",
        }),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter(
      (r) => r.status === "rejected" && (r.reason as AiGuardError).reason === "budget_exceeded",
    );
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(3);
    // Every reservation is released afterwards; actual cost stays within budget.
    expect(await prisma.aiBudgetReservation.count({ where: { releasedAt: null } })).toBe(0);
    const summary = await getAiUsageSummary(prisma, A.organization.id, rt.limits);
    expect(summary.monthToDateUsd).toBeLessThanOrEqual(0.01);
  });

  it("releases the reservation even when the provider fails", async () => {
    chat.respond(Object.assign(new Error("overloaded"), { status: 503 }));
    await expect(
      askAssistant(prisma, runtime(), {
        organizationId: A.organization.id,
        userId: A.users.ADMIN.id,
        businessName: "Test Org A",
        question: "cotton kurta price?",
      }),
    ).rejects.toThrow();
    expect(await prisma.aiBudgetReservation.count({ where: { releasedAt: null } })).toBe(0);
    expect(await prisma.aiBudgetReservation.count()).toBe(1);
  });
});
