import { FakeEmbeddingProvider, ScriptedChatProvider } from "@ravi/ai-engine/testing";
import { prisma } from "@ravi/db";
import { AiGuardError, type AiRuntime, createAiRuntime } from "@ravi/knowledge";
import { createTenantFixture, resetTestDatabase, type TenantFixture } from "@ravi/testing";
import { aiEnvSchema, parseEnv } from "@ravi/validation";
import { beforeEach, describe, expect, it } from "vitest";
import {
  askPlayground,
  getAiStatus,
  getSuggestion,
  listSuggestions,
  reviewSuggestion,
  setAiBudget,
  setAiConsent,
} from "../data/ai";
import {
  createDocument,
  getDocument,
  indexDocument,
  listDocuments,
  setDocumentArchived,
} from "../data/knowledge";
import { resolveTenant, TenantAccessError, type TenantContext } from "../tenancy/context";

let A: TenantFixture;
let B: TenantFixture;
let embedder: FakeEmbeddingProvider;
let chat: ScriptedChatProvider;
let runtime: AiRuntime;

const KB =
  "Cotton kurta price: Rs. 2,500. Silk kurta price: Rs. 6,000. Delivery in Lahore takes 2 days.";

async function ctxFor(
  f: TenantFixture,
  role: keyof TenantFixture["users"],
): Promise<TenantContext> {
  return resolveTenant(
    prisma,
    { id: f.users[role].id, emailVerified: true, twoFactorEnabled: true },
    f.organization.slug,
  );
}

async function expectForbidden(p: Promise<unknown>) {
  await expect(p).rejects.toSatisfy(
    (e: unknown) => e instanceof TenantAccessError && e.reason === "forbidden",
  );
}

beforeEach(async () => {
  await resetTestDatabase(prisma);
  A = await createTenantFixture(prisma, "A");
  B = await createTenantFixture(prisma, "B");
  embedder = new FakeEmbeddingProvider(768);
  chat = new ScriptedChatProvider("gemini-3.1-flash-lite");
  runtime = createAiRuntime(
    parseEnv(aiEnvSchema, {
      GEMINI_API_KEY: "test-key-never-sent",
      AI_RETRIEVAL_MIN_SIMILARITY: "0.1",
    }),
    {
      providers: { chat, embeddings: embedder },
    },
  );
});

describe("AI data-processing consent", () => {
  it("only owners can opt in or out, and it is audited", async () => {
    await expectForbidden(setAiConsent(await ctxFor(A, "ADMIN"), true));
    await setAiConsent(await ctxFor(A, "OWNER"), true);
    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { id: A.organization.id } }))
        .aiDataConsentAt,
    ).not.toBeNull();
    await setAiConsent(await ctxFor(A, "OWNER"), false);
    const actions = (
      await prisma.auditLog.findMany({ where: { organizationId: A.organization.id } })
    ).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["ai.consent_granted", "ai.consent_revoked"]));
  });

  it("blocks indexing and the playground until consent is given", async () => {
    const doc = await createDocument(await ctxFor(A, "ADMIN"), {
      title: "Prices",
      content: KB,
      sourceType: "MANUAL",
    });
    await expect(indexDocument(await ctxFor(A, "ADMIN"), runtime, doc.id)).rejects.toBeInstanceOf(
      AiGuardError,
    );
    await expect(
      askPlayground(await ctxFor(A, "ADMIN"), runtime, "kurta price?"),
    ).rejects.toBeInstanceOf(AiGuardError);
    expect(embedder.calls).toHaveLength(0);
    expect(chat.requests).toHaveLength(0);
  });
});

describe("AI budget", () => {
  it("owners may lower the cap but never exceed the platform limit", async () => {
    const owner = await ctxFor(A, "OWNER");
    await setAiBudget(owner, 10, 25);
    expect((await getAiStatus(owner, runtime)).usage.budgetUsd).toBe(10);
    await expect(setAiBudget(owner, 100, 25)).rejects.toThrow(/platform limit/);
    await expectForbidden(setAiBudget(await ctxFor(A, "ADMIN"), 5, 25));
  });
});

describe("knowledge documents (tenant-scoped)", () => {
  it("lets admins create documents but not agents or viewers", async () => {
    await createDocument(await ctxFor(A, "ADMIN"), {
      title: "Prices",
      content: KB,
      sourceType: "MANUAL",
    });
    await expectForbidden(
      createDocument(await ctxFor(A, "AGENT"), { title: "x", content: KB, sourceType: "MANUAL" }),
    );
    await expectForbidden(
      createDocument(await ctxFor(A, "VIEWER"), { title: "x", content: KB, sourceType: "MANUAL" }),
    );
    expect(await listDocuments(await ctxFor(A, "VIEWER"))).toHaveLength(1);
  });

  it("refuses documents containing card numbers or credentials", async () => {
    const admin = await ctxFor(A, "ADMIN");
    await expect(
      createDocument(admin, {
        title: "Payments",
        content: "Customers can pay with card 4111 1111 1111 1111 at the counter.",
        sourceType: "MANUAL",
      }),
    ).rejects.toThrow(/payment card numbers/);
    await expect(
      createDocument(admin, {
        title: "Admin notes",
        content: "Dashboard login password: SuperSecret123 for staff use only.",
        sourceType: "MANUAL",
      }),
    ).rejects.toThrow(/credentials/);
    expect(await prisma.knowledgeDocument.count()).toBe(0);
  });

  it("rejects duplicate content and validates input", async () => {
    const admin = await ctxFor(A, "ADMIN");
    await createDocument(admin, { title: "Prices", content: KB, sourceType: "MANUAL" });
    await expect(
      createDocument(admin, { title: "Copy", content: `  ${KB}\r\n`, sourceType: "MANUAL" }),
    ).rejects.toThrow(/already exists/);
    await expect(
      createDocument(admin, { title: "x", content: "too short", sourceType: "MANUAL" }),
    ).rejects.toThrow();
  });

  it("indexes with consent, records usage, and never exposes vectors", async () => {
    await setAiConsent(await ctxFor(A, "OWNER"), true);
    const admin = await ctxFor(A, "ADMIN");
    const doc = await createDocument(admin, { title: "Prices", content: KB, sourceType: "MANUAL" });
    await indexDocument(admin, runtime, doc.id);
    const loaded = await getDocument(admin, doc.id);
    expect(loaded?.status).toBe("READY");
    expect(loaded?.chunks[0]).not.toHaveProperty("embedding");
    const usage = await prisma.aiUsageEvent.findFirstOrThrow({
      where: { organizationId: A.organization.id },
    });
    expect(usage).toMatchObject({
      feature: "KNOWLEDGE_INDEXING",
      operation: "EMBEDDING",
      embeddingDimensions: 768,
    });
  });

  it("blocks reading, indexing or archiving another organization's documents by ID", async () => {
    await setAiConsent(await ctxFor(A, "OWNER"), true);
    const bDoc = await createDocument(await ctxFor(B, "ADMIN"), {
      title: "B secrets",
      content: KB,
      sourceType: "MANUAL",
    });
    const aAdmin = await ctxFor(A, "ADMIN");
    expect(await getDocument(aAdmin, bDoc.id)).toBeNull();
    await expect(indexDocument(aAdmin, runtime, bDoc.id)).rejects.toThrow(/not found/);
    await expect(setDocumentArchived(aAdmin, bDoc.id, true)).rejects.toThrow(/not found/);
    expect(embedder.calls).toHaveLength(0);
    expect(
      (await prisma.knowledgeDocument.findUniqueOrThrow({ where: { id: bDoc.id } })).status,
    ).toBe("DRAFT");
  });

  it("archives without deleting and restores the previous state", async () => {
    await setAiConsent(await ctxFor(A, "OWNER"), true);
    const admin = await ctxFor(A, "ADMIN");
    const doc = await createDocument(admin, { title: "Prices", content: KB, sourceType: "MANUAL" });
    await indexDocument(admin, runtime, doc.id);
    await setDocumentArchived(admin, doc.id, true);
    expect((await getDocument(admin, doc.id))?.status).toBe("ARCHIVED");
    expect(await prisma.knowledgeChunk.count({ where: { documentId: doc.id } })).toBeGreaterThan(0);
    await setDocumentArchived(admin, doc.id, false);
    expect((await getDocument(admin, doc.id))?.status).toBe("READY");
  });
});

describe("AI playground and review", () => {
  beforeEach(async () => {
    await setAiConsent(await ctxFor(A, "OWNER"), true);
    const admin = await ctxFor(A, "ADMIN");
    const doc = await createDocument(admin, { title: "Prices", content: KB, sourceType: "MANUAL" });
    await indexDocument(admin, runtime, doc.id);
  });

  it("is limited to owners and admins", async () => {
    await expectForbidden(askPlayground(await ctxFor(A, "AGENT"), runtime, "kurta price?"));
    await expectForbidden(askPlayground(await ctxFor(A, "VIEWER"), runtime, "kurta price?"));
    await expectForbidden(listSuggestions(await ctxFor(A, "AGENT")));
  });

  it("answers in Urdu from organization knowledge and stores the suggestion with sources", async () => {
    chat.answer({ answer: "کاٹن کرتے کی قیمت Rs. 2,500 ہے۔", sourceIds: [1], language: "urdu" });
    const { suggestionId } = await askPlayground(
      await ctxFor(A, "ADMIN"),
      runtime,
      "کاٹن کرتے کی قیمت کیا ہے؟ cotton kurta price",
    );
    const s = await getSuggestion(await ctxFor(A, "OWNER"), suggestionId);
    expect(s).toMatchObject({ decision: "REPLY", language: "urdu", status: "PENDING" });
    expect(s?.sources[0]).toMatchObject({ documentTitle: "Prices", cited: true });
  });

  it("isolates suggestions by organization and records reviews without sending anything", async () => {
    chat.answer({ answer: "Cotton kurta: Rs. 2,500.", sourceIds: [1] });
    const { suggestionId } = await askPlayground(
      await ctxFor(A, "ADMIN"),
      runtime,
      "cotton kurta price?",
    );

    const bOwner = await ctxFor(B, "OWNER");
    expect(await getSuggestion(bOwner, suggestionId)).toBeNull();
    expect(await listSuggestions(bOwner)).toEqual([]);
    await expect(reviewSuggestion(bOwner, suggestionId, { status: "APPROVED" })).rejects.toThrow(
      /not found/,
    );

    await reviewSuggestion(await ctxFor(A, "ADMIN"), suggestionId, {
      status: "APPROVED",
      rating: 5,
      notes: "Accurate",
    });
    const s = await prisma.aiSuggestion.findUniqueOrThrow({ where: { id: suggestionId } });
    expect(s).toMatchObject({
      status: "APPROVED",
      rating: 5,
      reviewNotes: "Accurate",
      reviewedByUserId: A.users.ADMIN.id,
    });

    // Approval is an evaluation signal only: no outbound message or send job exists.
    expect(await prisma.message.count({ where: { direction: "OUTBOUND" } })).toBe(0);
    expect(await prisma.job.count()).toBe(0);
    await expect(
      reviewSuggestion(await ctxFor(A, "ADMIN"), suggestionId, { status: "APPROVED", rating: 9 }),
    ).rejects.toThrow();
  });
});
