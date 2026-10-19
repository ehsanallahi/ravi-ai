/**
 * Registers a real WhatsApp Cloud API phone number for an organization.
 * Values come only from the operator; nothing is invented or seeded.
 *
 * Usage (from repo root):
 *   pnpm --filter @ravi/db account:register \
 *     --org-name "Your Business" --org-slug your-business \
 *     [--phone-number-id <ID from Meta>] [--waba-id <WABA ID>] [--display-phone "+1 555 …"]
 *
 * --phone-number-id and --waba-id default to WHATSAPP_PHONE_NUMBER_ID and
 * WHATSAPP_BUSINESS_ACCOUNT_ID from .env.
 *
 * The access token is read from WHATSAPP_ACCESS_TOKEN (never pass it on the command line,
 * because it would end up in shell history) and stored encrypted with ENCRYPTION_KEY.
 * The script creates, but never overwrites, an existing organization, and refuses to move a
 * phone number that belongs to another organization.
 */
import { parseArgs } from "node:util";
import { encryptSecret, parseEncryptionKey } from "@ravi/core";
import { prisma } from "../src/index";

async function main() {
  const { values } = parseArgs({
    options: {
      "org-name": { type: "string" },
      "org-slug": { type: "string" },
      "phone-number-id": { type: "string" },
      "waba-id": { type: "string" },
      "display-phone": { type: "string" },
      "rotate-token": { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  const orgName = values["org-name"]?.trim();
  const orgSlug = values["org-slug"]?.trim().toLowerCase();
  // Fall back to the IDs in .env (not secrets; shown in Meta App Dashboard → WhatsApp → API Setup).
  const phoneNumberId = (values["phone-number-id"] ?? process.env.WHATSAPP_PHONE_NUMBER_ID)?.trim();
  const wabaId = (values["waba-id"] ?? process.env.WHATSAPP_BUSINESS_ACCOUNT_ID)?.trim();

  if (!orgName || !orgSlug || !phoneNumberId || !wabaId) {
    throw new Error(
      "Required: --org-name, --org-slug, and --phone-number-id/--waba-id (or WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_BUSINESS_ACCOUNT_ID)",
    );
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(orgSlug)) throw new Error("--org-slug must be kebab-case");
  if (!/^\d+$/.test(phoneNumberId) || !/^\d+$/.test(wabaId)) {
    throw new Error("--phone-number-id and --waba-id must be numeric IDs from Meta");
  }

  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const keyB64 = process.env.ENCRYPTION_KEY;
  if (!token) throw new Error("Set WHATSAPP_ACCESS_TOKEN in the environment");
  if (!keyB64) throw new Error("Set ENCRYPTION_KEY in the environment (openssl rand -base64 32)");
  const ciphertext = encryptSecret(token, parseEncryptionKey(keyB64));

  const org =
    (await prisma.organization.findUnique({ where: { slug: orgSlug } })) ??
    (await prisma.organization.create({ data: { name: orgName, slug: orgSlug } }));

  const existing = await prisma.whatsAppAccount.findUnique({ where: { phoneNumberId } });
  if (existing && existing.organizationId !== org.id) {
    throw new Error("This phone number ID is already registered to another organization");
  }
  if (existing && !values["rotate-token"]) {
    console.log(
      `Account already registered (id ${existing.id}). Pass --rotate-token to replace the token.`,
    );
    return;
  }

  const account = existing
    ? await prisma.whatsAppAccount.update({
        where: { id: existing.id },
        data: { accessTokenCiphertext: ciphertext, wabaId },
      })
    : await prisma.whatsAppAccount.create({
        data: {
          organizationId: org.id,
          phoneNumberId,
          wabaId,
          displayPhoneNumber: values["display-phone"] ?? null,
          accessTokenCiphertext: ciphertext,
        },
      });

  await prisma.auditLog.create({
    data: {
      organizationId: org.id,
      action: existing ? "whatsapp.token_rotated" : "whatsapp.account_registered",
      targetType: "WhatsAppAccount",
      targetId: account.id,
      metadata: { phoneNumberId, via: "cli" },
    },
  });

  console.log(
    `Registered phone number ${phoneNumberId} for organization "${org.name}" (${org.slug}).`,
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
