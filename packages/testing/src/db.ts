import type { PrismaClient } from "@ravi/db";
import { assertSafeTestDatabaseUrl } from "./safety";

/**
 * Empties every application table between tests. Guarded: it only runs against a local
 * database whose name ends in "_test", and it never touches the migrations table.
 */
export async function resetTestDatabase(prisma: PrismaClient): Promise<void> {
  assertSafeTestDatabaseUrl(process.env.DATABASE_URL);
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"public"."${r.tablename.replace(/"/g, '""')}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}
