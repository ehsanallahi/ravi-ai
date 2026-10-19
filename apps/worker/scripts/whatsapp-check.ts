/**
 * Read-only WhatsApp Cloud API connection diagnostic.
 *
 *   pnpm whatsapp:check                     # token from WHATSAPP_ACCESS_TOKEN
 *   pnpm whatsapp:check -- --token-source db  # token stored (encrypted) for the registered number
 *   pnpm whatsapp:check -- --offline          # configuration and database only, no Meta calls
 *
 * Only GET requests are made to Meta: it never sends a message, subscribes an app or changes
 * any setting, and it never writes to the database. Secrets are never printed (only whether
 * they are set and look well-formed).
 */
import { parseArgs } from "node:util";
import { decryptSecret, parseEncryptionKey } from "@ravi/core";
import { prisma } from "@ravi/db";
import { diagnoseConnection, type DiagnosticCheck, redactToken } from "@ravi/whatsapp";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    "token-source": { type: "string", default: "env" },
    offline: { type: "boolean", default: false },
  },
});

const checks: DiagnosticCheck[] = [];
const add = (name: string, status: DiagnosticCheck["status"], detail: string) =>
  checks.push({ name, status, detail });
const env = (name: string) => process.env[name]?.trim() || "";

function checkConfig() {
  const verifyToken = env("WHATSAPP_VERIFY_TOKEN");
  add(
    "WHATSAPP_VERIFY_TOKEN",
    verifyToken.length >= 32 ? "pass" : verifyToken ? "warn" : "fail",
    verifyToken.length >= 32
      ? `set (${verifyToken.length} chars)`
      : verifyToken
        ? `set but short (${verifyToken.length} chars; use openssl rand -hex 32)`
        : "missing: needed for Meta's webhook verification handshake",
  );

  const appSecret = env("WHATSAPP_APP_SECRET");
  add(
    "WHATSAPP_APP_SECRET",
    /^[0-9a-f]{32}$/i.test(appSecret) ? "pass" : appSecret ? "warn" : "fail",
    /^[0-9a-f]{32}$/i.test(appSecret)
      ? "set (32 hex chars)"
      : appSecret
        ? "set, but Meta app secrets are usually 32 hex characters"
        : "missing: every webhook POST will be rejected (401)",
  );

  const version = env("WHATSAPP_GRAPH_API_VERSION") || "v24.0";
  add("WHATSAPP_GRAPH_API_VERSION", /^v\d+\.\d+$/.test(version) ? "pass" : "fail", version);

  for (const name of ["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID"]) {
    const value = env(name);
    add(
      name,
      /^\d{6,20}$/.test(value) ? "pass" : "fail",
      /^\d{6,20}$/.test(value) ? `set (${value.length} digits)` : value ? "not numeric" : "missing",
    );
  }

  const key = env("ENCRYPTION_KEY");
  try {
    parseEncryptionKey(key);
    add("ENCRYPTION_KEY", "pass", "set (32 bytes)");
  } catch {
    add("ENCRYPTION_KEY", "fail", key ? "invalid (expected 32 random bytes, base64)" : "missing");
  }

  if (values["token-source"] === "env") {
    const token = env("WHATSAPP_ACCESS_TOKEN");
    add(
      "WHATSAPP_ACCESS_TOKEN",
      token ? "pass" : values.offline ? "warn" : "fail",
      token ? `set (${token.length} chars)` : "missing",
    );
  }

  const appId = env("WHATSAPP_APP_ID");
  add(
    "WHATSAPP_APP_ID (optional)",
    /^\d+$/.test(appId) ? "pass" : "warn",
    /^\d+$/.test(appId)
      ? "set: used to confirm your app is subscribed to webhooks"
      : "not set: cannot confirm which app receives webhooks",
  );

  if (process.env.AI_AUTO_REPLY_ENABLED?.trim().toLowerCase() === "true") {
    add("AI_AUTO_REPLY_ENABLED", "fail", "must stay false until sending is approved");
  } else {
    add("AI_AUTO_REPLY_ENABLED", "pass", "false (automatic replies are off)");
  }
}

async function checkRegistration(): Promise<string | null> {
  const phoneNumberId = env("WHATSAPP_PHONE_NUMBER_ID");
  if (!/^\d+$/.test(phoneNumberId)) return null;
  const account = await prisma.whatsAppAccount.findUnique({
    where: { phoneNumberId },
    include: { organization: { select: { slug: true, aiAutoReplyEnabled: true } } },
  });
  if (!account) {
    add(
      "Registered in Ravi AI",
      "warn",
      "not registered: inbound webhooks for this number are ignored until `pnpm --filter @ravi/db account:register` is run",
    );
    return null;
  }
  add(
    "Registered in Ravi AI",
    account.status === "ACTIVE" ? "pass" : "warn",
    `organization ${account.organization.slug} · status ${account.status}`,
  );
  if (account.wabaId !== env("WHATSAPP_BUSINESS_ACCOUNT_ID")) {
    add(
      "Registered account ID",
      "warn",
      "stored WABA ID differs from WHATSAPP_BUSINESS_ACCOUNT_ID",
    );
  }
  add(
    "Organization auto-reply",
    account.organization.aiAutoReplyEnabled ? "warn" : "pass",
    account.organization.aiAutoReplyEnabled
      ? "enabled for the organization (still blocked by AI_AUTO_REPLY_ENABLED=false)"
      : "off",
  );

  if (!account.accessTokenCiphertext) {
    add("Stored access token", "warn", "none stored");
    return null;
  }
  try {
    const token = decryptSecret(
      account.accessTokenCiphertext,
      parseEncryptionKey(env("ENCRYPTION_KEY")),
    );
    add("Stored access token", "pass", "decrypts with ENCRYPTION_KEY");
    return token;
  } catch {
    add("Stored access token", "fail", "cannot be decrypted with the current ENCRYPTION_KEY");
    return null;
  }
}

async function main() {
  checkConfig();
  let storedToken: string | null = null;
  try {
    storedToken = await checkRegistration();
  } catch (err) {
    add(
      "Database",
      "warn",
      `not reachable (${err instanceof Error ? err.name : "error"}); is pnpm db:local running?`,
    );
  }

  const token = values["token-source"] === "db" ? storedToken : env("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = env("WHATSAPP_PHONE_NUMBER_ID");
  const wabaId = env("WHATSAPP_BUSINESS_ACCOUNT_ID");

  if (values.offline) {
    add("Meta Graph API", "warn", "skipped (--offline)");
  } else if (!token || !/^\d+$/.test(phoneNumberId) || !/^\d+$/.test(wabaId)) {
    add("Meta Graph API", "fail", "skipped: access token, phone number ID or account ID missing");
  } else {
    const result = await diagnoseConnection({
      accessToken: token,
      graphApiVersion: env("WHATSAPP_GRAPH_API_VERSION") || "v24.0",
      phoneNumberId,
      wabaId,
      appId: /^\d+$/.test(env("WHATSAPP_APP_ID")) ? env("WHATSAPP_APP_ID") : undefined,
    });
    checks.push(...result.checks.map((c) => ({ ...c, detail: redactToken(c.detail, token) })));
  }

  console.log("WhatsApp Cloud API diagnostic (read-only; no messages are sent)\n");
  for (const c of checks) {
    const tag = c.status === "pass" ? "PASS" : c.status === "warn" ? "WARN" : "FAIL";
    console.log(`${tag}  ${c.name.padEnd(36)} ${c.detail}`);
  }
  const failed = checks.filter((c) => c.status === "fail").length;
  console.log(`\n${failed ? `${failed} check(s) failed.` : "No failures."}`);
  process.exitCode = failed ? 1 : 0;
}

main()
  .catch((err) => {
    const token = env("WHATSAPP_ACCESS_TOKEN");
    console.error(redactToken(err instanceof Error ? err.message : String(err), token));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
