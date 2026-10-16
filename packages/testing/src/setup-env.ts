import { afterAll, inject } from "vitest";
import { assertSafeTestDatabaseUrl } from "./safety";

// Runs in each test worker before test files import @ravi/db, so the Prisma client
// connects to the throwaway test database.
const url = inject("testDatabaseUrl");
assertSafeTestDatabaseUrl(url);
process.env.DATABASE_URL = url;
process.env.NODE_ENV = "test";

afterAll(async () => {
  const { prisma } = await import("@ravi/db");
  await prisma.$disconnect();
});
