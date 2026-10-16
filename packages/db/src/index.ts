import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

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
