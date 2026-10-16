const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export class UnsafeDatabaseError extends Error {
  constructor(reason: string) {
    super(`Refusing to use this database for tests: ${reason}`);
    this.name = "UnsafeDatabaseError";
  }
}

/**
 * Guards every destructive test operation (migrations, truncation, fixtures).
 * The database must be on this machine AND its name must end with "_test".
 * Never weaken this check: it is what stops tests from touching dev or production data.
 */
export function assertSafeTestDatabaseUrl(url: string | undefined): URL {
  if (!url) throw new UnsafeDatabaseError("no database URL provided");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeDatabaseError("URL is not parseable");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new UnsafeDatabaseError("not a PostgreSQL URL");
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new UnsafeDatabaseError(`host "${parsed.hostname}" is not local`);
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!database.endsWith("_test")) {
    throw new UnsafeDatabaseError(`database "${database}" does not end with "_test"`);
  }
  return parsed;
}
