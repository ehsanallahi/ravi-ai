import type { AiRuntime } from "@ravi/knowledge";
import type { Logger } from "@ravi/core";
import type { Job, PrismaClient } from "@ravi/db";
import type { WorkerEnv } from "@ravi/validation";

export { JOB_TYPES } from "@ravi/core";

export interface WorkerContext {
  prisma: PrismaClient;
  env: WorkerEnv;
  log: Logger;
  /** AI providers, limits and prices. Auto-replies additionally need AI_AUTO_REPLY_ENABLED. */
  ai: AiRuntime;
  encryptionKey: Buffer | null;
  now: () => Date;
}

export type JobHandler = (job: Job, ctx: WorkerContext) => Promise<void>;

/** Throw for failures that will never succeed on retry (bad payload, missing config). */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}

/** WhatsApp allows free-form replies only within 24 hours of the customer's last message. */
export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWithinServiceWindow(lastInboundAt: Date | null, now: Date): boolean {
  return !!lastInboundAt && now.getTime() - lastInboundAt.getTime() < CUSTOMER_SERVICE_WINDOW_MS;
}

/** Payload for jobs that reference a single message. */
export function messageIdFromPayload(payload: unknown): string {
  const id = (payload as { messageId?: unknown } | null)?.messageId;
  if (typeof id !== "string" || !id)
    throw new NonRetryableError("Job payload is missing messageId");
  return id;
}
