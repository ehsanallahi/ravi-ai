import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "../../..");
export const DB_PACKAGE_DIR = path.join(REPO_ROOT, "packages", "db");

export async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("no port")),
      );
    });
  });
}

export function randomPassword(): string {
  return randomBytes(18).toString("base64url");
}

export interface LocalCluster {
  pg: EmbeddedPostgres;
  port: number;
  user: string;
  password: string;
  urlFor(database: string): string;
}

/**
 * Starts a PostgreSQL cluster from the embedded-postgres binaries. It listens on 127.0.0.1
 * only. With `persistent: false`, the data directory is deleted when the cluster stops.
 */
export async function startCluster(options: {
  databaseDir: string;
  port: number;
  password: string;
  persistent: boolean;
  initialise: boolean;
}): Promise<LocalCluster> {
  const user = "ravi";
  const pg = new EmbeddedPostgres({
    databaseDir: options.databaseDir,
    port: options.port,
    user,
    password: options.password,
    authMethod: "scram-sha-256",
    persistent: options.persistent,
    postgresFlags: ["-c", "listen_addresses=127.0.0.1"],
    onLog: () => undefined,
    onError: () => undefined,
  });
  if (options.initialise) await pg.initialise();
  await pg.start();
  return {
    pg,
    port: options.port,
    user,
    password: options.password,
    urlFor: (database) =>
      `postgresql://${user}:${encodeURIComponent(options.password)}@127.0.0.1:${options.port}/${database}`,
  };
}

/** Applies committed migrations with `prisma migrate deploy` (never `migrate dev` or `reset`). */
export function migrateDeploy(databaseUrl: string): void {
  const prismaCli = createRequire(path.join(DB_PACKAGE_DIR, "package.json")).resolve(
    "prisma/build/index.js",
  );
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: DB_PACKAGE_DIR,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });
}
