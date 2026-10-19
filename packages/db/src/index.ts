import { PrismaClient } from "@prisma/client";

// Explicit value exports (not `export *`) so bundlers don't have to guess the exports of the
// CommonJS Prisma client. Model and enum types are re-exported as types.
export { Prisma, PrismaClient } from "@prisma/client";
export type * from "@prisma/client";

const globalForPrisma = globalThis as unknown as { __raviPrisma?: PrismaClient };

/**
 * Shared Prisma client. In development the instance is cached on `globalThis` so Next.js hot
 * reloads do not open a new connection pool on every change.
 */
export const prisma: PrismaClient =
  globalForPrisma.__raviPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.__raviPrisma = prisma;

export interface DatabaseHealth {
  ok: boolean;
  latencyMs: number;
}

/** Readiness probe: a trivial query with a timeout. Never returns connection details. */
export async function checkDatabaseHealth(
  client: PrismaClient = prisma,
  timeoutMs = 2_000,
): Promise<DatabaseHealth> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
    return { ok: true, latencyMs: Date.now() - started };
  } catch {
    return { ok: false, latencyMs: Date.now() - started };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Dimension of KnowledgeChunk.embedding (pgvector column type vector(768)). Changing it requires
 * a migration and a re-index; configuration is validated against this value.
 */
export const KNOWLEDGE_EMBEDDING_DIMENSIONS = 768;

/** Prisma error code for unique constraint violations. */
export const UNIQUE_VIOLATION = "P2002";

export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}
