import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { REPO_ROOT } from "./postgres";

/** Built pgvector files are kept here (git-ignored) so reinstalls of node_modules can restore them. */
export const PGVECTOR_ARTIFACTS_DIR = path.join(REPO_ROOT, ".data", "pgvector", "pg18");

/** The embedded-postgres platform package's native directory (binaries, lib, share). */
export function embeddedNativeDir(): string {
  // The platform package is a dependency of embedded-postgres (not of this package), so resolve
  // it from there; pnpm's strict layout would hide it otherwise.
  const fromTesting = createRequire(path.join(REPO_ROOT, "packages", "testing", "package.json"));
  const fromEmbedded = createRequire(fromTesting.resolve("embedded-postgres"));
  const pkg = `@embedded-postgres/${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
  const entry = fromEmbedded.resolve(pkg);
  // <pkg>/dist/index.js → <pkg>/native
  return path.join(path.dirname(path.dirname(entry)), "native");
}

export class PgvectorMissingError extends Error {
  constructor(detail: string) {
    super(
      `${detail}\nThe local PostgreSQL needs the pgvector extension.\n` +
        (process.platform === "win32"
          ? "  Run: pnpm db:pgvector:setup   (builds pgvector with Visual Studio C++ tools)\n"
          : "  Use a PostgreSQL with pgvector (e.g. docker run pgvector/pgvector:pg16) and set TEST_DATABASE_URL / DATABASE_URL.\n"),
    );
    this.name = "PgvectorMissingError";
  }
}

/**
 * Makes sure the embedded PostgreSQL can `CREATE EXTENSION vector`. Copies previously built files
 * from .data/pgvector into the embedded distribution if a reinstall removed them. Idempotent.
 */
export function ensurePgvectorInstalled(): void {
  const native = embeddedNativeDir();
  const extensionDir = path.join(native, "share", "extension");
  if (existsSync(path.join(extensionDir, "vector.control"))) return;

  if (!existsSync(path.join(PGVECTOR_ARTIFACTS_DIR, "vector.control"))) {
    throw new PgvectorMissingError("pgvector is not built yet.");
  }
  const libName = process.platform === "win32" ? "vector.dll" : "vector.so";
  mkdirSync(extensionDir, { recursive: true });
  copyFileSync(path.join(PGVECTOR_ARTIFACTS_DIR, libName), path.join(native, "lib", libName));
  for (const file of readdirSync(PGVECTOR_ARTIFACTS_DIR)) {
    if (file === "vector.control" || /^vector--.*\.sql$/.test(file)) {
      copyFileSync(path.join(PGVECTOR_ARTIFACTS_DIR, file), path.join(extensionDir, file));
    }
  }
}
