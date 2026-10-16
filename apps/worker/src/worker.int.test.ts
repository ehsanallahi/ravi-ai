import { DisabledProvider, InMemoryRetriever } from "@ravi/ai-engine";
import { createLogger, JOB_TYPES } from "@ravi/core";
import { type Job, prisma } from "@ravi/db";
import { createTenantFixture, resetTestDatabase, type TenantFixture } from "@ravi/testing";
import type { WorkerEnv } from "@ravi/validation";
import { textMessagePayload } from "@ravi/whatsapp/fixtures";
import { beforeEach, describe, expect, it } from "vitest";
import { handleWhatsAppWebhook } from "./handlers/whatsapp-webhook";
import type { WorkerContext } from "./jobs";
import { enqueueJob, PostgresJobQueue } from "./queue";

let A: TenantFixture;
let B: TenantFixture;

const ctx: WorkerContext = {
  prisma,
  // AI replies and live sending stay disabled.
  env: { AI_AUTO_REPLY_ENABLED: false, WHATSAPP_GRAPH_API_VERSION: "v24.0" } as WorkerEnv,
  log: createLogger({}, "error"),
  provider: new DisabledProvider(),
  retriever: new InMemoryRetriever(new Map()),
  encryptionKey: null,
  now: () => new Date(),
};

function webhookFor(phoneNumberId: string, messageId: string, body = "Hello") {
  const payload = textMessagePayload({ messageId, body });
  payload.entry[0]!.changes[0]!.value.metadata.phone_number_id = phoneNumberId;
  return payload;
}

function asJob(payload: unknown): Job {
  return {
    id: "job",
    type: JOB_TYPES.whatsappWebhook,
    payload,
    attempts: 1,
    maxAttempts: 8,
  } as Job;
}

beforeEach(async () => {
  await resetTestDatabase(prisma);
  A = await createTenantFixture(prisma, "A");
  B = await createTenantFixture(prisma, "B");
});

describe("webhook organization routing", () => {
  it("stores an inbound message only under the organization that owns the phone number", async () => {
    await handleWhatsAppWebhook(
      asJob(webhookFor(A.whatsappAccount.phoneNumberId, "wamid.ROUTE_A")),
      ctx,
    );

    const message = await prisma.message.findFirstOrThrow({
      where: { waMessageId: "wamid.ROUTE_A" },
    });
    expect(message.organizationId).toBe(A.organization.id);
    const contact = await prisma.contact.findFirstOrThrow({
      where: { organizationId: A.organization.id, waId: "15550000001" },
    });
    expect(contact.profileName).toBe("Test User");
    expect(
      await prisma.contact.count({
        where: { organizationId: B.organization.id, waId: "15550000001" },
      }),
    ).toBe(0);
    expect(await prisma.message.count({ where: { organizationId: B.organization.id } })).toBe(1); // fixture only
  });

  it("keeps the same customer separate per organization", async () => {
    await handleWhatsAppWebhook(
      asJob(webhookFor(A.whatsappAccount.phoneNumberId, "wamid.SAME_1")),
      ctx,
    );
    await handleWhatsAppWebhook(
      asJob(webhookFor(B.whatsappAccount.phoneNumberId, "wamid.SAME_2")),
      ctx,
    );
    const contacts = await prisma.contact.findMany({ where: { waId: "15550000001" } });
    expect(contacts.map((c) => c.organizationId).sort()).toEqual(
      [A.organization.id, B.organization.id].sort(),
    );
  });

  it("ignores webhooks for unregistered or disabled numbers, never creating tenants", async () => {
    const before = await prisma.organization.count();
    await handleWhatsAppWebhook(asJob(webhookFor("999999999999999", "wamid.UNKNOWN")), ctx);
    await prisma.whatsAppAccount.update({
      where: { id: B.whatsappAccount.id },
      data: { status: "DISABLED" },
    });
    await handleWhatsAppWebhook(
      asJob(webhookFor(B.whatsappAccount.phoneNumberId, "wamid.DISABLED")),
      ctx,
    );
    expect(
      await prisma.message.count({
        where: { waMessageId: { in: ["wamid.UNKNOWN", "wamid.DISABLED"] } },
      }),
    ).toBe(0);
    expect(await prisma.organization.count()).toBe(before);
  });

  it("is idempotent for redelivered webhooks", async () => {
    const job = asJob(webhookFor(A.whatsappAccount.phoneNumberId, "wamid.DUP"));
    await handleWhatsAppWebhook(job, ctx);
    await handleWhatsAppWebhook(job, ctx);
    expect(await prisma.message.count({ where: { waMessageId: "wamid.DUP" } })).toBe(1);
  });

  it("records opt-outs and never enqueues AI replies while AI is disabled", async () => {
    await prisma.organization.update({
      where: { id: A.organization.id },
      data: { aiAutoReplyEnabled: true },
    });
    await handleWhatsAppWebhook(
      asJob(webhookFor(A.whatsappAccount.phoneNumberId, "wamid.STOP", "STOP")),
      ctx,
    );
    expect(
      (
        await prisma.contact.findFirstOrThrow({
          where: { organizationId: A.organization.id, waId: "15550000001" },
        })
      ).optedOutAt,
    ).not.toBeNull();
    expect(
      await prisma.job.count({
        where: { type: { in: [JOB_TYPES.aiReply, JOB_TYPES.whatsappSend] } },
      }),
    ).toBe(0);
  });
});

describe("Postgres job queue", () => {
  it("claims each job exactly once across concurrent workers", async () => {
    for (let i = 0; i < 20; i++) {
      await enqueueJob(prisma, { type: "test.noop", payload: { i }, dedupeKey: `noop-${i}` });
    }
    const workers = ["w1", "w2", "w3", "w4"].map((id) => new PostgresJobQueue(prisma, id));
    const claimed = (await Promise.all(workers.map((w) => w.claim(10)))).flat();
    const ids = claimed.map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(20);
    expect(claimed.every((j) => j.attempts === 1 && j.status === "RUNNING")).toBe(true);
  });

  it("deduplicates jobs by key and recovers stale locks", async () => {
    await enqueueJob(prisma, { type: "test.noop", payload: {}, dedupeKey: "once" });
    await enqueueJob(prisma, { type: "test.noop", payload: {}, dedupeKey: "once" });
    expect(await prisma.job.count({ where: { dedupeKey: "once" } })).toBe(1);

    const queue = new PostgresJobQueue(prisma, "w1");
    const [job] = await queue.claim(1);
    await prisma.job.update({
      where: { id: job!.id },
      data: { lockedAt: new Date(Date.now() - 60 * 60_000) },
    });
    expect(await queue.recoverStale(10 * 60_000)).toBe(1);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job!.id } })).status).toBe("PENDING");
  });
});
