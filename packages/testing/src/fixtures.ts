import { randomUUID } from "node:crypto";
import type { MembershipRole, PrismaClient } from "@ravi/db";

/**
 * Synthetic fixtures for the throwaway TEST database only. Names and numbers are obviously fake
 * ("Test Org A", 1555…) and are never written to a development or production database.
 */
export interface TenantFixture {
  organization: { id: string; slug: string; name: string };
  users: Record<MembershipRole, { id: string; email: string }>;
  whatsappAccount: { id: string; phoneNumberId: string };
  contact: { id: string };
  conversation: { id: string };
  message: { id: string };
  lead: { id: string };
}

const ROLES: MembershipRole[] = ["OWNER", "ADMIN", "AGENT", "VIEWER"];

export async function createTenantFixture(
  prisma: PrismaClient,
  label: string,
  options: { twoFactorEnabled?: boolean } = {},
): Promise<TenantFixture> {
  const key = label.toLowerCase();
  const suffix = randomUUID().slice(0, 8);
  const organization = await prisma.organization.create({
    data: { name: `Test Org ${label}`, slug: `test-org-${key}-${suffix}` },
  });

  const users = {} as TenantFixture["users"];
  for (const role of ROLES) {
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `${role.toLowerCase()}.${key}.${suffix}@example.test`,
        name: `${role} ${label}`,
        emailVerified: true,
        twoFactorEnabled: options.twoFactorEnabled ?? true,
      },
    });
    await prisma.membership.create({
      data: { organizationId: organization.id, userId: user.id, role },
    });
    users[role] = { id: user.id, email: user.email };
  }

  const phoneNumberId = `1${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 15);
  const whatsappAccount = await prisma.whatsAppAccount.create({
    data: {
      organizationId: organization.id,
      phoneNumberId,
      wabaId: "100000000000000",
      displayPhoneNumber: "+1 555 000 0000",
      accessTokenCiphertext: "v1:test:test:test",
    },
  });
  const contact = await prisma.contact.create({
    data: { organizationId: organization.id, waId: `1555${suffix.replace(/\D/g, "0")}` },
  });
  const conversation = await prisma.conversation.create({
    data: {
      organizationId: organization.id,
      contactId: contact.id,
      whatsappAccountId: whatsappAccount.id,
      lastMessageAt: new Date(),
    },
  });
  const message = await prisma.message.create({
    data: {
      organizationId: organization.id,
      conversationId: conversation.id,
      direction: "INBOUND",
      senderType: "CONTACT",
      body: `Test message for ${label}`,
      status: "RECEIVED",
      waMessageId: `wamid.TEST_${key}_${suffix}`,
    },
  });
  const lead = await prisma.lead.create({
    data: { organizationId: organization.id, contactId: contact.id, title: `Test lead ${label}` },
  });

  return {
    organization: { id: organization.id, slug: organization.slug, name: organization.name },
    users,
    whatsappAccount: { id: whatsappAccount.id, phoneNumberId },
    contact: { id: contact.id },
    conversation: { id: conversation.id },
    message: { id: message.id },
    lead: { id: lead.id },
  };
}
