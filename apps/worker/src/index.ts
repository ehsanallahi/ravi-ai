import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { createProvider } from "@ravi/ai-engine";
import { createLogger, errorMessage, parseEncryptionKey } from "@ravi/core";
import { checkDatabaseHealth, prisma } from "@ravi/db";
import { parseEnv, workerEnvSchema } from "@ravi/validation";
import { handlers } from "./handlers";
import type { WorkerContext } from "./jobs";
import { PostgresJobQueue } from "./queue";
import { PostgresFullTextRetriever } from "./retriever";
import { runJob } from "./runner";

const STALE_SWEEP_INTERVAL_MS = 60_000;

async function main() {
  const env = parseEnv(workerEnvSchema);
  const workerId = env.WORKER_ID ?? `${hostname()}-${process.pid}`;
  const log = createLogger({ service: "worker", workerId });

  const health = await checkDatabaseHealth(prisma);
  if (!health.ok) throw new Error("Database is not reachable; check DATABASE_URL");

  const ctx: WorkerContext = {
    prisma,
    env,
    log,
    provider: createProvider(
      env.AI_PROVIDER === "anthropic"
        ? { provider: "anthropic", apiKey: env.ANTHROPIC_API_KEY, model: env.AI_MODEL }
        : { provider: "disabled" },
    ),
    retriever: new PostgresFullTextRetriever(prisma),
    encryptionKey: env.ENCRYPTION_KEY ? parseEncryptionKey(env.ENCRYPTION_KEY) : null,
    now: () => new Date(),
  };
  const queue = new PostgresJobQueue(prisma, workerId);

  const controller = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      log.info("shutdown requested", { signal });
      controller.abort();
    });
  }

  log.info("worker started", {
    aiAutoReply: env.AI_AUTO_REPLY_ENABLED,
    aiProvider: env.AI_PROVIDER,
    batchSize: env.WORKER_BATCH_SIZE,
  });

  let lastSweep = 0;
  while (!controller.signal.aborted) {
    try {
      if (Date.now() - lastSweep > STALE_SWEEP_INTERVAL_MS) {
        const recovered = await queue.recoverStale(env.WORKER_LOCK_TIMEOUT_MS);
        if (recovered) log.warn("recovered stale jobs", { recovered });
        lastSweep = Date.now();
      }
      const jobs = await queue.claim(env.WORKER_BATCH_SIZE);
      if (jobs.length > 0) {
        await Promise.all(jobs.map((job) => runJob(job, handlers, queue, ctx)));
        continue;
      }
    } catch (err) {
      log.error("worker loop error", { error: errorMessage(err) });
    }
    await sleep(env.WORKER_POLL_INTERVAL_MS, undefined, { signal: controller.signal }).catch(
      () => undefined,
    );
  }

  await prisma.$disconnect();
  log.info("worker stopped");
}

main().catch(async (err) => {
  console.error(errorMessage(err));
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
