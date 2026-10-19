import { createAiRuntime } from "@ravi/knowledge";
import { aiEnvSchema } from "@ravi/validation";
import { createLogger } from "@ravi/core";
import type { Job, PrismaClient } from "@ravi/db";
import type { WorkerEnv } from "@ravi/validation";
import { describe, expect, it, vi } from "vitest";
import {
  isWithinServiceWindow,
  messageIdFromPayload,
  NonRetryableError,
  type WorkerContext,
} from "./jobs";
import { isOptOutRequest, shouldApplyStatus, toMessageStatus, toMessageType } from "./mappers";
import { compareMessages, MAX_FUTURE_SKEW_MS, orderTime, orderTimeFilter } from "./message-order";
import type { JobQueue } from "./queue";
import { computeBackoffMs, runJob } from "./runner";

const ctx: WorkerContext = {
  prisma: {} as PrismaClient,
  env: { AI_AUTO_REPLY_ENABLED: false } as WorkerEnv,
  log: createLogger({}, "error"),
  // No API key: AI is not configured, and auto-replies stay disabled.
  ai: createAiRuntime(aiEnvSchema.parse({})),
  encryptionKey: null,
  now: () => new Date("2026-01-01T00:00:00Z"),
};

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "job_1",
    type: "test.job",
    payload: {},
    status: "RUNNING",
    dedupeKey: null,
    organizationId: null,
    attempts: 1,
    maxAttempts: 3,
    runAt: new Date(),
    lockedAt: new Date(),
    lockedBy: "w1",
    lastError: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeQueue() {
  return {
    claim: vi.fn(),
    complete: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    markDead: vi.fn(async () => undefined),
    recoverStale: vi.fn(),
  } satisfies JobQueue;
}

describe("computeBackoffMs", () => {
  it("grows exponentially and is capped", () => {
    const fixed = { random: () => 1 };
    expect(computeBackoffMs(1, fixed)).toBe(5_000);
    expect(computeBackoffMs(2, fixed)).toBe(10_000);
    expect(computeBackoffMs(3, fixed)).toBe(20_000);
    expect(computeBackoffMs(30, fixed)).toBe(15 * 60_000);
  });

  it("applies jitter within [exp/2, exp]", () => {
    expect(computeBackoffMs(2, { random: () => 0 })).toBe(5_000);
  });
});

describe("runJob", () => {
  it("completes successful jobs", async () => {
    const queue = fakeQueue();
    const handler = vi.fn(async () => undefined);
    expect(await runJob(job(), { "test.job": handler }, queue, ctx)).toBe("completed");
    expect(queue.complete).toHaveBeenCalledWith("job_1");
  });

  it("retries transient failures with a future runAt", async () => {
    const queue = fakeQueue();
    const handler = vi.fn(async () => {
      throw new Error("db timeout");
    });
    expect(await runJob(job(), { "test.job": handler }, queue, ctx)).toBe("retry");
    const [, error, runAt] = queue.retry.mock.calls[0] as unknown as [string, string, Date];
    expect(error).toBe("db timeout");
    expect(runAt.getTime()).toBeGreaterThan(ctx.now().getTime());
  });

  it("dead-letters non-retryable errors, exhausted attempts and unknown types", async () => {
    const queue = fakeQueue();
    const nonRetryable = vi.fn(async () => {
      throw new NonRetryableError("bad payload");
    });
    expect(await runJob(job(), { "test.job": nonRetryable }, queue, ctx)).toBe("dead");

    const transient = vi.fn(async () => {
      throw new Error("still down");
    });
    expect(await runJob(job({ attempts: 3 }), { "test.job": transient }, queue, ctx)).toBe("dead");

    expect(await runJob(job({ type: "unknown" }), {}, queue, ctx)).toBe("dead");
    expect(queue.markDead).toHaveBeenCalledTimes(3);
    expect(queue.retry).not.toHaveBeenCalled();
  });
});

describe("mappers", () => {
  it("maps WhatsApp message types", () => {
    expect(toMessageType("text")).toBe("TEXT");
    expect(toMessageType("image")).toBe("IMAGE");
    expect(toMessageType("something_new")).toBe("UNSUPPORTED");
  });

  it("maps statuses and ignores unknown ones", () => {
    expect(toMessageStatus("read")).toBe("READ");
    expect(toMessageStatus("deleted")).toBeNull();
  });

  it("only moves statuses forward", () => {
    expect(shouldApplyStatus("PENDING", "SENT")).toBe(true);
    expect(shouldApplyStatus("SENT", "READ")).toBe(true);
    expect(shouldApplyStatus("READ", "DELIVERED")).toBe(false);
    expect(shouldApplyStatus("SENT", "FAILED")).toBe(true);
    expect(shouldApplyStatus("DELIVERED", "FAILED")).toBe(false);
    expect(shouldApplyStatus("FAILED", "SENT")).toBe(false);
  });

  it("recognises opt-out keywords only as whole messages", () => {
    expect(isOptOutRequest("STOP")).toBe(true);
    expect(isOptOutRequest(" unsubscribe. ")).toBe(true);
    expect(isOptOutRequest("please don't stop sending offers")).toBe(false);
    expect(isOptOutRequest(null)).toBe(false);
  });
});

describe("job helpers", () => {
  it("checks the 24h customer service window", () => {
    const now = new Date("2026-01-02T00:00:00Z");
    expect(isWithinServiceWindow(new Date("2026-01-01T01:00:00Z"), now)).toBe(true);
    expect(isWithinServiceWindow(new Date("2025-12-31T23:00:00Z"), now)).toBe(false);
    expect(isWithinServiceWindow(null, now)).toBe(false);
  });

  it("validates message job payloads", () => {
    expect(messageIdFromPayload({ messageId: "m1" })).toBe("m1");
    expect(() => messageIdFromPayload({})).toThrow(NonRetryableError);
  });
});

describe("message order", () => {
  const at = (iso: string) => new Date(iso);
  const msg = (id: string, wa: string | null, created: string) => ({
    id,
    waTimestamp: wa === null ? null : at(wa),
    createdAt: at(created),
  });

  it("orders by WhatsApp send time, not insertion time (concurrent or late delivery)", () => {
    // Sent 2nd but inserted 3rd, and sent 3rd but inserted 2nd (as seen in local testing).
    const english = msg("m1", "2026-10-19T14:08:42Z", "2026-10-19T14:08:43.046Z");
    const urdu = msg("m3", "2026-10-19T14:08:45Z", "2026-10-19T14:08:45.306Z");
    const romanUrdu = msg("m2", "2026-10-19T14:08:43Z", "2026-10-19T14:08:45.339Z");
    expect([urdu, romanUrdu, english].sort(compareMessages).map((m) => m.id)).toEqual([
      "m1",
      "m2",
      "m3",
    ]);
  });

  it("breaks equal timestamps by receipt time, then id, deterministically", () => {
    const a = msg("b", "2026-10-19T10:00:00Z", "2026-10-19T10:00:01.000Z");
    const b = msg("a", "2026-10-19T10:00:00Z", "2026-10-19T10:00:01.000Z");
    const c = msg("c", "2026-10-19T10:00:00Z", "2026-10-19T10:00:00.500Z");
    expect([a, b, c].sort(compareMessages).map((m) => m.id)).toEqual(["c", "a", "b"]);
    expect(compareMessages(a, a)).toBe(0);
  });

  it("falls back to receipt time for missing, invalid or implausible timestamps", () => {
    const created = "2026-10-19T10:00:00.000Z";
    const t = at(created).getTime();
    expect(orderTime(msg("x", null, created))).toBe(t);
    expect(orderTime({ id: "x", waTimestamp: new Date(Number.NaN), createdAt: at(created) })).toBe(
      t,
    );
    // Sent "in the future" beyond clock skew, or impossibly long ago.
    expect(orderTime(msg("x", "2027-01-01T00:00:00Z", created))).toBe(t);
    expect(orderTime(msg("x", "1970-01-02T00:00:00Z", created))).toBe(t);
    // Within skew or a few days late: trusted.
    const skewed = new Date(t + MAX_FUTURE_SKEW_MS - 1000).toISOString();
    expect(orderTime(msg("x", skewed, created))).toBe(at(skewed).getTime());
    expect(orderTime(msg("x", "2026-10-16T10:00:00Z", created))).toBe(
      at("2026-10-16T10:00:00Z").getTime(),
    );
  });

  it("prefilters on both timestamps so no earlier or later message is missed", () => {
    const m = msg("x", "2026-10-19T10:00:00Z", "2026-10-19T10:00:05Z");
    const t = at("2026-10-19T10:00:00Z");
    expect(orderTimeFilter(m, "before")).toEqual({
      OR: [{ waTimestamp: { lte: t } }, { createdAt: { lte: t } }],
    });
    expect(orderTimeFilter(m, "after")).toEqual({
      OR: [{ waTimestamp: { gte: t } }, { createdAt: { gte: t } }],
    });
  });
});
