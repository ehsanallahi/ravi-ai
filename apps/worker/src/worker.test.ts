import { DisabledProvider, InMemoryRetriever } from "@ravi/ai-engine";
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
import type { JobQueue } from "./queue";
import { computeBackoffMs, runJob } from "./runner";

const ctx: WorkerContext = {
  prisma: {} as PrismaClient,
  env: { AI_AUTO_REPLY_ENABLED: false } as WorkerEnv,
  log: createLogger({}, "error"),
  provider: new DisabledProvider(),
  retriever: new InMemoryRetriever(new Map()),
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
