/**
 * Knowledge-base integration test against the REAL Gemini API and the local DEV database,
 * using FICTIONAL data only. It only creates new rows (two new fictional organizations); it never
 * modifies or deletes existing records, and it never sends anything to WhatsApp.
 *
 *   pnpm ai:kb-test
 *
 * Requires GEMINI_API_KEY and a localhost DATABASE_URL (refuses remote databases).
 * Writes a JSON report to .data/eval/.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@ravi/db";
import { AiGuardError, createAiRuntime, PgHybridRetriever } from "@ravi/knowledge";
import { extractDocumentText } from "@ravi/knowledge/extract";
import { aiEnvSchema, parseEnv } from "@ravi/validation";
import {
  askPlayground,
  getSuggestion,
  reviewSuggestion,
  setAiBudget,
  setAiConsent,
} from "../src/server/data/ai";
import { createDocument, indexDocument } from "../src/server/data/knowledge";
import { resolveTenant } from "../src/server/tenancy/context";

const results: { check: string; pass: boolean; detail?: string }[] = [];
const check = (name: string, pass: boolean, detail?: string) => {
  results.push({ check: name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

/** Minimal valid PDF (to exercise server-side PDF extraction with fictional text). */
function fictionalPdf(lines: string[]): Uint8Array {
  const stream = lines.map((l, i) => `BT /F1 11 Tf 72 ${740 - i * 16} Td (${l}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

async function fictionalOrg(label: string) {
  const suffix = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({
    data: {
      name: `Fictional Demo Shop ${label} (test)`,
      slug: `fictional-demo-${label.toLowerCase()}-${suffix}`,
    },
  });
  // Fictional test users with no password (cannot sign in); 2FA flag set so tenancy checks pass.
  const owner = await prisma.user.create({
    data: {
      id: randomUUID(),
      email: `owner.${suffix}@example.test`,
      name: `Demo Owner ${label}`,
      emailVerified: true,
      twoFactorEnabled: true,
    },
  });
  await prisma.membership.create({
    data: { organizationId: org.id, userId: owner.id, role: "OWNER" },
  });
  const ctx = await resolveTenant(
    prisma,
    { id: owner.id, emailVerified: true, twoFactorEnabled: true },
    org.slug,
  );
  return { org, ctx };
}

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://missing");
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("Refusing to run: DATABASE_URL must point to a local development database.");
  }
  const env = parseEnv(aiEnvSchema);
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  const runtime = createAiRuntime(env);
  if (!runtime.configured) {
    throw new Error(
      'AI is disabled (AI_PROVIDER is not "gemini"). For this run only: AI_PROVIDER=gemini pnpm ai:kb-test',
    );
  }
  console.log(
    `Models: chat ${runtime.models.chat} · embeddings ${runtime.models.embedding} (${runtime.models.dimensions})\n`,
  );

  const before = {
    jobs: await prisma.job.count(),
    outbound: await prisma.message.count({ where: { direction: "OUTBOUND" } }),
  };

  // 1. Fictional organizations and consent
  const A = await fictionalOrg("A");
  const B = await fictionalOrg("B");
  await setAiConsent(A.ctx, true);
  await setAiConsent(B.ctx, true);
  check(
    "created two fictional organizations with owner consent",
    true,
    `${A.org.slug}, ${B.org.slug}`,
  );

  // 2. Fictional documents: pasted FAQ, uploaded Markdown, uploaded PDF (A); different catalog (B)
  const docsA: { id: string; title: string }[] = [];
  const faq = await createDocument(A.ctx, {
    title: "FAQ (fictional)",
    sourceType: "MANUAL",
    content:
      "Fictional Demo Shop A is open Monday to Saturday, 10am to 8pm, and closed on Sunday.\n\n" +
      "Delivery in Lahore takes 2 days and costs Rs. 150. Delivery to other cities takes 5 days and costs Rs. 300.\n\n" +
      "Lahore mein delivery 2 din mein hoti hai aur charges Rs. 150 hain.",
  });
  docsA.push({ id: faq.id, title: "FAQ (fictional)" });

  const md = await extractDocumentText(
    "products.md",
    new TextEncoder().encode(
      "# Products (fictional)\n\nKhaddar kurta: Rs. 3,200.\n\nEmbroidered shawl: Rs. 5,500.\n\nChildren's kurta: Rs. 1,800.",
    ),
  );
  const products = await createDocument(A.ctx, {
    title: "Products (fictional)",
    content: md.text,
    sourceType: "FILE",
    sourceFilename: "products.md",
  });
  docsA.push({ id: products.id, title: "Products (fictional)" });

  const pdf = await extractDocumentText(
    "policies.pdf",
    fictionalPdf([
      "Return policy (fictional): unworn items can be exchanged within 10 days with the receipt.",
      "We do not offer cash refunds.",
      "Gift wrapping is available for Rs. 100.",
    ]),
  );
  check(
    "PDF upload: server-side text extraction works",
    pdf.kind === "pdf" && pdf.text.includes("10 days"),
  );
  const policies = await createDocument(A.ctx, {
    title: "Policies (fictional)",
    content: pdf.text,
    sourceType: "FILE",
    sourceFilename: "policies.pdf",
  });
  docsA.push({ id: policies.id, title: "Policies (fictional)" });

  const urdu = await createDocument(A.ctx, {
    title: "اردو معلومات (فرضی)",
    sourceType: "MANUAL",
    content:
      "فرضی ڈیمو شاپ اے پیر سے ہفتہ صبح 10 بجے سے رات 8 بجے تک کھلی ہے۔ اتوار کو دکان بند رہتی ہے۔ کھدر کرتے کی قیمت 3,200 روپے ہے۔",
  });
  docsA.push({ id: urdu.id, title: "اردو معلومات (فرضی)" });

  const docB = await createDocument(B.ctx, {
    title: "Catalog B (fictional)",
    sourceType: "MANUAL",
    content:
      "Fictional Demo Shop B sells blue running sneakers for Rs. 7,999 and canvas backpacks for Rs. 2,450.",
  });

  // 3. Index through real Gemini embeddings
  let chunksA = 0;
  for (const d of docsA) chunksA += (await indexDocument(A.ctx, runtime, d.id)).chunks;
  await indexDocument(B.ctx, runtime, docB.id);
  check(
    "indexed fictional documents with Gemini embeddings",
    chunksA > 0,
    `${chunksA} chunks for A`,
  );

  const vec = await prisma.$queryRaw<{ dims: number; norm: number; model: string; n: bigint }[]>`
    SELECT vector_dims(embedding) AS dims, round(vector_norm(embedding)::numeric, 3)::float8 AS norm,
           "embeddingModel" AS model, count(*) OVER () AS n
    FROM "KnowledgeChunk" WHERE "organizationId" = ${A.org.id} LIMIT 1`;
  check(
    "vectors stored in pgvector at the configured dimensions",
    vec[0]?.dims === runtime.models.dimensions && vec[0]?.model === runtime.models.embedding,
    `dims ${vec[0]?.dims}, norm ${vec[0]?.norm}, model ${vec[0]?.model}`,
  );

  // 4. Retrieval (direct, org-scoped)
  const retriever = new PgHybridRetriever(prisma, runtime.embeddings, runtime.retrieval);
  const hits = await retriever.retrieve({
    organizationId: A.org.id,
    query: "khaddar kurta price",
    limit: 3,
  });
  check(
    "retrieval finds the relevant fictional product",
    hits[0]?.documentId === products.id,
    `top similarity ${hits[0]?.similarity?.toFixed(3)}`,
  );
  const crossHits = await retriever.retrieve({
    organizationId: A.org.id,
    query: "blue running sneakers price",
    limit: 5,
  });
  check(
    "org A retrieval never returns org B content",
    crossHits.every((h) => h.documentId !== docB.id),
    `${crossHits.length} hits, none from B`,
  );

  // 5. Playground questions (EN / Roman Urdu / Urdu / insufficient / cross-org)
  const asked: Record<string, unknown>[] = [];
  const ask = async (label: string, question: string) => {
    const started = Date.now();
    const { suggestionId, decision } = await askPlayground(A.ctx, runtime, question);
    const s = await getSuggestion(A.ctx, suggestionId);
    const row = {
      label,
      question,
      decision: decision.kind,
      reason: decision.kind === "handoff" ? decision.reason : undefined,
      answer: decision.kind === "reply" ? decision.text : undefined,
      language: decision.language,
      cited: s?.sources.filter((x) => x.cited).map((x) => x.documentTitle),
      sourceDocIds: s?.sources.map((x) => x.documentId),
      costUsd: Number(s?.estimatedCostUsd ?? 0),
      latencyMs: Date.now() - started,
      suggestionId,
    };
    asked.push(row);
    console.log(
      `      ${label}: ${row.decision}${row.answer ? ` → ${String(row.answer).replace(/\s+/g, " ").slice(0, 90)}` : ` (${row.reason})`}`,
    );
    return row;
  };

  const en = await ask("english-price", "How much is the khaddar kurta?");
  check(
    "English answer is grounded and cites a source",
    en.decision === "reply" &&
      String(en.answer).match(/3,?200/) !== null &&
      (en.cited?.length ?? 0) > 0,
    en.cited?.join(", "),
  );
  const ru = await ask("roman-urdu-delivery", "Lahore mein delivery kitne din mein hogi?");
  check(
    "Roman Urdu answer stays in Roman Urdu and is grounded",
    ru.decision === "reply" && !/[؀-ۿ]/.test(String(ru.answer)) && String(ru.answer).includes("2"),
    `language ${ru.language}`,
  );
  const ur = await ask("urdu-hours", "کیا دکان اتوار کو کھلی ہوتی ہے؟");
  check(
    "Urdu answer is in Urdu script",
    ur.decision === "reply" && /[؀-ۿ]/.test(String(ur.answer)),
    `language ${ur.language}`,
  );
  const pol = await ask("english-policy", "Can I return an item for a cash refund?");
  check(
    "policy answer comes from the uploaded PDF",
    pol.decision === "reply" && (pol.cited ?? []).includes("Policies (fictional)"),
    pol.cited?.join(", "),
  );
  const none = await ask("insufficient", "How much is the silk saree?");
  check(
    "hands off when the knowledge base lacks the answer",
    none.decision === "handoff",
    String(none.reason),
  );
  const stock = await ask("stock-level", "How many khaddar kurtas are left in stock?");
  check(
    "hands off on stock levels (not in knowledge)",
    stock.decision === "handoff",
    String(stock.reason),
  );
  const cross = await ask("cross-org", "What is the price of the blue running sneakers?");
  check(
    "cross-organization isolation in answers (no org B data)",
    cross.decision === "handoff" &&
      !(cross.sourceDocIds ?? []).includes(docB.id) &&
      !String(cross.answer ?? "").includes("7,999"),
    String(cross.reason),
  );
  const allSourcesFromA = asked.every((a) =>
    ((a.sourceDocIds as string[]) ?? []).every((id) => docsA.some((d) => d.id === id)),
  );
  check("every source shown for org A belongs to org A", allSourcesFromA);

  // 6. Review workflow (records only)
  await reviewSuggestion(A.ctx, String(en.suggestionId), {
    status: "APPROVED",
    rating: 5,
    notes: "fictional test",
  });
  await reviewSuggestion(A.ctx, String(none.suggestionId), {
    status: "REJECTED",
    rating: 3,
    notes: "fictional test",
  });
  const approved = await getSuggestion(A.ctx, String(en.suggestionId));
  const crossReview = await getSuggestion(B.ctx, String(en.suggestionId));
  check(
    "approve/reject is recorded and other orgs cannot see it",
    approved?.status === "APPROVED" && crossReview === null,
  );
  const after = {
    jobs: await prisma.job.count(),
    outbound: await prisma.message.count({ where: { direction: "OUTBOUND" } }),
  };
  check(
    "nothing was queued or sent to WhatsApp",
    after.jobs === before.jobs && after.outbound === before.outbound,
  );

  // 7. Budget enforcement (on the fictional org only)
  await setAiBudget(A.ctx, 0, runtime.limits.monthlyBudgetUsd);
  let blocked = false;
  try {
    await askPlayground(A.ctx, runtime, "How much is the khaddar kurta?");
  } catch (err) {
    blocked = err instanceof AiGuardError && err.reason === "budget_exceeded";
  }
  await setAiBudget(A.ctx, null, runtime.limits.monthlyBudgetUsd);
  check("per-organization budget blocks further AI calls", blocked);

  // 8. Usage accounting
  const usage = await prisma.aiUsageEvent.groupBy({
    by: ["operation", "model", "success"],
    where: { organizationId: { in: [A.org.id, B.org.id] } },
    _count: { _all: true },
    _sum: { estimatedCostUsd: true, inputTokens: true, outputTokens: true, thinkingTokens: true },
    _avg: { latencyMs: true },
  });
  const failed = usage.filter((u) => !u.success);
  check(
    "every AI call recorded with model, tokens and cost",
    usage.length > 0 && failed.length === 0,
    `${usage.reduce((n, u) => n + u._count._all, 0)} calls`,
  );
  const totalCost = usage.reduce((s, u) => s + Number(u._sum.estimatedCostUsd ?? 0), 0);
  console.log(`\nTotal estimated cost: $${totalCost.toFixed(6)}`);

  const outDir = path.resolve(import.meta.dirname, "../../../.data/eval");
  mkdirSync(outDir, { recursive: true });
  const file = path.join(
    outDir,
    `kb-integration-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  writeFileSync(
    file,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        models: runtime.models,
        organizations: [A.org.slug, B.org.slug],
        results,
        questions: asked,
        usage: usage.map((u) => ({
          operation: u.operation,
          model: u.model,
          success: u.success,
          calls: u._count._all,
          costUsd: Number(u._sum.estimatedCostUsd ?? 0),
          inputTokens: u._sum.inputTokens,
          outputTokens: u._sum.outputTokens,
          thinkingTokens: u._sum.thinkingTokens,
          avgLatencyMs: Math.round(u._avg.latencyMs ?? 0),
        })),
        totalCostUsd: totalCost,
      },
      null,
      2,
    ),
  );
  const passed = results.filter((r) => r.pass).length;
  console.log(
    `\n${passed}/${results.length} checks passed · report ${path.relative(process.cwd(), file)}`,
  );
  process.exitCode = passed === results.length ? 0 : 1;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
