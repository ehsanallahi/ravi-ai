/**
 * Runs a persistent local PostgreSQL cluster for development (no Docker or system install).
 *
 *   pnpm db:local          # start (initialises on first run), Ctrl+C to stop
 *
 * - Data lives in <repo>/.data/pg-utf8 (git-ignored). Stopping never deletes it.
 * - Listens on 127.0.0.1 only, port LOCAL_PG_PORT (default 54329).
 * - Creates `ravi_ai_dev` and `ravi_ai_test` on first run. A random password is generated once
 *   and stored in .data/pg-utf8-credentials.json (git-ignored). It is a local-only credential.
 * - Does not run migrations. Review them, then run `pnpm db:migrate:deploy`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ensurePgvectorInstalled } from "../src/pgvector";
import { randomPassword, REPO_ROOT, startCluster } from "../src/postgres";

const DATA_ROOT = path.join(REPO_ROOT, ".data");
// UTF-8 cluster. (An older ".data/postgres" cluster may exist with the Windows default WIN1252
// encoding, which cannot store Urdu; it is left untouched and can be deleted manually.)
const DATA_DIR = path.join(DATA_ROOT, "pg-utf8");
const CREDENTIALS_FILE = path.join(DATA_ROOT, "pg-utf8-credentials.json");
const DATABASES = ["ravi_ai_dev", "ravi_ai_test"];

async function main() {
  const port = Number(process.env.LOCAL_PG_PORT ?? 54329);
  const firstRun = !existsSync(path.join(DATA_DIR, "PG_VERSION"));
  mkdirSync(DATA_ROOT, { recursive: true });

  let password: string;
  if (firstRun) {
    password = randomPassword();
    writeFileSync(CREDENTIALS_FILE, JSON.stringify({ user: "ravi", password }, null, 2), {
      mode: 0o600,
    });
  } else {
    password = (JSON.parse(readFileSync(CREDENTIALS_FILE, "utf8")) as { password: string })
      .password;
  }

  ensurePgvectorInstalled();
  const cluster = await startCluster({
    databaseDir: DATA_DIR,
    port,
    password,
    persistent: true,
    initialise: firstRun,
  });

  if (firstRun) {
    for (const db of DATABASES) await cluster.pg.createDatabase(db);
  }

  console.log(
    `PostgreSQL is running on 127.0.0.1:${port} (data: ${path.relative(REPO_ROOT, DATA_DIR)})`,
  );
  console.log("Connection strings (local only; also stored in .data/pg-utf8-credentials.json):");
  for (const db of DATABASES) console.log(`  ${db}: ${cluster.urlFor(db)}`);
  if (firstRun) {
    console.log("\nFirst run: put the ravi_ai_dev URL in .env as DATABASE_URL, then run:");
    console.log("  pnpm db:migrate:deploy");
  }
  console.log("\nPress Ctrl+C to stop.");

  const stop = async () => {
    await cluster.pg.stop();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  setInterval(() => undefined, 1 << 30);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
