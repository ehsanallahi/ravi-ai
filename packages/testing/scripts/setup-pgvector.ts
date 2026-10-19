/**
 * Builds pgvector for the local embedded PostgreSQL 18 on Windows (one-time setup).
 *
 *   pnpm db:pgvector:setup
 *
 * Steps (all under .data/, which is git-ignored):
 *  1. Downloads EnterpriseDB's official PostgreSQL 18.4 Windows binaries (~340 MB) and extracts
 *     only the server headers and postgres.lib (needed to compile extensions).
 *  2. Downloads the pgvector source release.
 *  3. Compiles it with the Visual Studio C++ toolchain (vcvars64 + nmake).
 *  4. Copies vector.dll, vector.control and SQL files to .data/pgvector/pg18 and installs them
 *     into the embedded PostgreSQL.
 *
 * CI and non-Windows machines use the official pgvector Docker image instead.
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ensurePgvectorInstalled, PGVECTOR_ARTIFACTS_DIR } from "../src/pgvector";
import { REPO_ROOT } from "../src/postgres";

const PG_VERSION = "18.4";
const PGVECTOR_VERSION = "0.8.7";
const VENDOR = path.join(REPO_ROOT, ".data", "vendor");
const EDB_ZIP = path.join(VENDOR, `edb-postgresql-${PG_VERSION}-1-windows-x64-binaries.zip`);
const EDB_URL = `https://get.enterprisedb.com/postgresql/postgresql-${PG_VERSION}-1-windows-x64-binaries.zip`;
const PGV_TGZ = path.join(VENDOR, `pgvector-${PGVECTOR_VERSION}.tar.gz`);
const PGV_URL = `https://codeload.github.com/pgvector/pgvector/tar.gz/refs/tags/v${PGVECTOR_VERSION}`;

async function download(url: string, file: string) {
  if (existsSync(file)) return;
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status} ${url}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file));
}

function findVcvars(): string {
  const vswhere = "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe";
  if (existsSync(vswhere)) {
    const root = execFileSync(vswhere, [
      "-latest",
      "-products",
      "*",
      "-requires",
      "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
      "-property",
      "installationPath",
    ])
      .toString()
      .trim();
    const candidate = path.join(root, "VC", "Auxiliary", "Build", "vcvars64.bat");
    if (root && existsSync(candidate)) return candidate;
  }
  throw new Error(
    "Visual Studio C++ build tools (vcvars64.bat) not found. Install 'Desktop development with C++'.",
  );
}

async function main() {
  if (process.platform !== "win32") {
    console.log(
      "Not Windows: use a PostgreSQL with pgvector (e.g. pgvector/pgvector Docker image).",
    );
    return;
  }
  if (existsSync(path.join(PGVECTOR_ARTIFACTS_DIR, "vector.dll"))) {
    ensurePgvectorInstalled();
    console.log("pgvector already built; installed into the embedded PostgreSQL.");
    return;
  }

  mkdirSync(VENDOR, { recursive: true });
  await download(EDB_URL, EDB_ZIP);
  await download(PGV_URL, PGV_TGZ);

  const pgRoot = path.join(VENDOR, "pg18");
  if (!existsSync(path.join(pgRoot, "pgsql", "lib", "postgres.lib"))) {
    mkdirSync(pgRoot, { recursive: true });
    // Windows' bsdtar reads zip archives; extract only headers and the import library.
    execFileSync("C:\\Windows\\System32\\tar.exe", [
      "-xf",
      EDB_ZIP,
      "-C",
      pgRoot,
      "pgsql/include",
      "pgsql/lib/postgres.lib",
    ]);
  }
  const src = path.join(VENDOR, `pgvector-${PGVECTOR_VERSION}`);
  if (!existsSync(src))
    execFileSync("C:\\Windows\\System32\\tar.exe", ["-xzf", PGV_TGZ, "-C", VENDOR]);

  const script = path.join(VENDOR, "build-pgvector.cmd");
  writeFileSync(
    script,
    [
      "@echo off",
      `call "${findVcvars()}" >nul || exit /b 1`,
      `set "PGROOT=${path.join(pgRoot, "pgsql")}"`,
      `cd /d "${src}" || exit /b 1`,
      "nmake /nologo /F Makefile.win || exit /b 1",
    ].join("\r\n"),
  );
  console.log("Compiling pgvector with MSVC…");
  execFileSync("cmd.exe", ["/c", script], { stdio: "inherit" });

  mkdirSync(PGVECTOR_ARTIFACTS_DIR, { recursive: true });
  copyFileSync(path.join(src, "vector.dll"), path.join(PGVECTOR_ARTIFACTS_DIR, "vector.dll"));
  copyFileSync(
    path.join(src, "vector.control"),
    path.join(PGVECTOR_ARTIFACTS_DIR, "vector.control"),
  );
  for (const f of readdirSync(path.join(src, "sql"))) {
    if (/^vector--.*\.sql$/.test(f))
      copyFileSync(path.join(src, "sql", f), path.join(PGVECTOR_ARTIFACTS_DIR, f));
  }
  ensurePgvectorInstalled();
  console.log(`pgvector ${PGVECTOR_VERSION} built and installed for PostgreSQL ${PG_VERSION}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
