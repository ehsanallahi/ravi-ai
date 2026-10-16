import { prisma } from "@ravi/db";
import { assertPermission, type TenantContext } from "../tenancy/context";

/**
 * Connection status only. The access token is never selected (not even its ciphertext), so it
 * cannot reach a page, a log or the client bundle. Only whether one is stored is reported.
 */
export async function listWhatsAppAccounts(ctx: TenantContext) {
  assertPermission(ctx, "settings:manage");
  const where = { organizationId: ctx.organizationId };
  const [accounts, withToken] = await Promise.all([
    prisma.whatsAppAccount.findMany({
      where,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        phoneNumberId: true,
        wabaId: true,
        displayPhoneNumber: true,
        verifiedName: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.whatsAppAccount.findMany({
      where: { ...where, accessTokenCiphertext: { not: null } },
      select: { id: true },
    }),
  ]);
  const tokenIds = new Set(withToken.map((a) => a.id));
  return accounts.map((a) => ({ ...a, hasAccessToken: tokenIds.has(a.id) }));
}
