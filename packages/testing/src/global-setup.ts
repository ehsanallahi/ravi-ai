import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestProject } from "vitest/node";
import {
  findFreePort,
  type LocalCluster,
  migrateDeploy,
  randomPassword,
  startCluster,
} from "./postgres";
import { assertSafeTestDatabaseUrl } from "./safety";

declare module "vitest" {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}

const TEST_DATABASE = "ravi_ai_test";

/**
 * Vitest globalSetup for integration tests.
 * - If TEST_DATABASE_URL is set (for example, a CI service container), it is used after the
 *   safety check.
 * - Otherwise, a throwaway PostgreSQL cluster is started in a temp directory and deleted
 *   afterwards. Dev and production databases are never involved.
 */
export default async function setup(project: TestProject) {
  let cluster: LocalCluster | null = null;
  let tempDir: string | null = null;
  let url = process.env.TEST_DATABASE_URL;

  if (!url) {
    tempDir = mkdtempSync(path.join(tmpdir(), "ravi-ai-pg-"));
    cluster = await startCluster({
      databaseDir: path.join(tempDir, "data"),
      port: await findFreePort(),
      password: randomPassword(),
      persistent: false,
      initialise: true,
    });
    await cluster.pg.createDatabase(TEST_DATABASE);
    url = cluster.urlFor(TEST_DATABASE);
  }

  assertSafeTestDatabaseUrl(url);
  migrateDeploy(url);
  project.provide("testDatabaseUrl", url);

  return async () => {
    if (cluster) await cluster.pg.stop().catch(() => undefined);
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  };
}
