/**
 * Minimal structured JSON logger: one line per event, safe for log aggregation.
 * Never pass secrets or full message bodies in `fields`.
 */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

function resolveLevel(value: string | undefined): Level {
  return value && value in ORDER ? (value as Level) : "info";
}

export function createLogger(
  base: Record<string, unknown> = {},
  minLevel: Level = resolveLevel(process.env.LOG_LEVEL),
): Logger {
  const log = (level: Level, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[level] < ORDER[minLevel]) return;
    const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...base, ...fields });
    if (level === "error" || level === "warn") console.error(line);
    else console.log(line);
  };
  return {
    debug: (m, f) => log("debug", m, f),
    info: (m, f) => log("info", m, f),
    warn: (m, f) => log("warn", m, f),
    error: (m, f) => log("error", m, f),
    child: (fields) => createLogger({ ...base, ...fields }, minLevel),
  };
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
