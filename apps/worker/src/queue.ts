import type { Job, Prisma, PrismaClient } from "@ravi/db";

export interface JobQueue {
  claim(limit: number): Promise<Job[]>;
  complete(id: string): Promise<void>;
  retry(id: string, error: string, runAt: Date): Promise<void>;
  markDead(id: string, error: string): Promise<void>;
  recoverStale(lockTimeoutMs: number): Promise<number>;
}

export interface EnqueueInput {
  type: string;
  payload: Prisma.InputJsonValue;
  dedupeKey?: string;
  organizationId?: string | null;
  runAt?: Date;
  maxAttempts?: number;
}

type JobWriter = Pick<PrismaClient, "job">;

/** Enqueues idempotently: a second job with the same dedupe key is ignored. */
export async function enqueueJob(db: JobWriter, input: EnqueueInput): Promise<void> {
  await db.job.createMany({
    data: [
      {
        type: input.type,
        payload: input.payload,
        dedupeKey: input.dedupeKey ?? null,
        organizationId: input.organizationId ?? null,
        runAt: input.runAt ?? new Date(),
        ...(input.maxAttempts ? { maxAttempts: input.maxAttempts } : {}),
      },
    ],
    skipDuplicates: true,
  });
}

const MAX_ERROR_LENGTH = 4000;
const truncate = (s: string) => (s.length > MAX_ERROR_LENGTH ? s.slice(0, MAX_ERROR_LENGTH) : s);

/** Postgres-backed queue using FOR UPDATE SKIP LOCKED, so replicas never claim the same job. */
export class PostgresJobQueue implements JobQueue {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly workerId: string,
  ) {}

  async claim(limit: number): Promise<Job[]> {
    return this.prisma.$queryRaw<Job[]>`
      UPDATE "Job"
      SET status = 'RUNNING'::"JobStatus",
          "lockedAt" = now(),
          "lockedBy" = ${this.workerId},
          attempts = attempts + 1,
          "updatedAt" = now()
      WHERE id IN (
        SELECT id FROM "Job"
        WHERE status = 'PENDING'::"JobStatus" AND "runAt" <= now()
        ORDER BY "runAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *`;
  }

  async complete(id: string): Promise<void> {
    await this.prisma.job.update({
      where: { id },
      data: { status: "COMPLETED", completedAt: new Date(), lockedAt: null, lockedBy: null },
    });
  }

  async retry(id: string, error: string, runAt: Date): Promise<void> {
    await this.prisma.job.update({
      where: { id },
      data: {
        status: "PENDING",
        runAt,
        lastError: truncate(error),
        lockedAt: null,
        lockedBy: null,
      },
    });
  }

  async markDead(id: string, error: string): Promise<void> {
    await this.prisma.job.update({
      where: { id },
      data: { status: "DEAD", lastError: truncate(error), lockedAt: null, lockedBy: null },
    });
  }

  async recoverStale(lockTimeoutMs: number): Promise<number> {
    const { count } = await this.prisma.job.updateMany({
      where: { status: "RUNNING", lockedAt: { lt: new Date(Date.now() - lockTimeoutMs) } },
      data: { status: "PENDING", lockedAt: null, lockedBy: null },
    });
    return count;
  }
}
