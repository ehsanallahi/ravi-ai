import { errorMessage } from "@ravi/core";
import type { Job } from "@ravi/db";
import { type JobHandler, NonRetryableError, type WorkerContext } from "./jobs";
import type { JobQueue } from "./queue";

/** Exponential backoff with full jitter: base * 2^(attempt-1), capped. */
export function computeBackoffMs(
  attempt: number,
  { baseMs = 5_000, capMs = 15 * 60_000, random = Math.random } = {},
): number {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + random() * (exp / 2));
}

/** Runs one claimed job and records the outcome. Never throws. */
export async function runJob(
  job: Job,
  handlers: Record<string, JobHandler>,
  queue: JobQueue,
  ctx: WorkerContext,
): Promise<"completed" | "retry" | "dead"> {
  const log = ctx.log.child({ jobId: job.id, jobType: job.type, attempt: job.attempts });
  const handler = handlers[job.type];
  try {
    if (!handler) throw new NonRetryableError(`No handler registered for job type "${job.type}"`);
    await handler(job, { ...ctx, log });
    await queue.complete(job.id);
    log.info("job completed");
    return "completed";
  } catch (err) {
    const message = errorMessage(err);
    if (err instanceof NonRetryableError || job.attempts >= job.maxAttempts) {
      await queue
        .markDead(job.id, message)
        .catch((e) => log.error("markDead failed", { error: errorMessage(e) }));
      log.error("job dead", { error: message });
      return "dead";
    }
    const delay = computeBackoffMs(job.attempts);
    await queue
      .retry(job.id, message, new Date(ctx.now().getTime() + delay))
      .catch((e) => log.error("retry scheduling failed", { error: errorMessage(e) }));
    log.warn("job failed, will retry", { error: message, retryInMs: delay });
    return "retry";
  }
}
