import { can, PERMISSIONS, ROLES } from "@ravi/core";
import { prisma } from "@ravi/db";
import { createTenantFixture, resetTestDatabase, type TenantFixture } from "@ravi/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { getContact, listContacts, setContactOptOut } from "../data/contacts";
import {
  assignConversation,
  disableConversationAi,
  getConversation,
  listConversations,
  setConversationStatus,
} from "../data/conversations";
import { createLead, getLead, listLeads, updateLead } from "../data/leads";
import { getOverviewStats } from "../data/overview";
import { listWhatsAppAccounts } from "../data/whatsapp";
import { resolveTenant, TenantAccessError, type TenantContext } from "../tenancy/context";

let A: TenantFixture;
let B: TenantFixture;

async function ctxFor(
  fixture: TenantFixture,
  role: keyof TenantFixture["users"],
): Promise<TenantContext> {
  return resolveTenant(
    prisma,
    { id: fixture.users[role].id, emailVerified: true, twoFactorEnabled: true },
    fixture.organization.slug,
  );
}

async function expectAccessError(promise: Promise<unknown>, reason: string) {
  await expect(promise).rejects.toSatisfy(
    (e: unknown) => e instanceof TenantAccessError && e.reason === reason,
  );
}

beforeEach(async () => {
  await resetTestDatabase(prisma);
  A = await createTenantFixture(prisma, "A");
  B = await createTenantFixture(prisma, "B");
});

describe("resolveTenant (central authorization)", () => {
  it("rejects unauthenticated users", async () => {
    await expectAccessError(resolveTenant(prisma, null, A.organization.slug), "unauthenticated");
  });

  it("returns not_found (not forbidden) for organizations the user is not a member of", async () => {
    const user = { id: A.users.OWNER.id, emailVerified: true, twoFactorEnabled: true };
    await expectAccessError(resolveTenant(prisma, user, B.organization.slug), "not_found");
    await expectAccessError(resolveTenant(prisma, user, "does-not-exist"), "not_found");
    await expectAccessError(resolveTenant(prisma, user, "../../etc"), "not_found");
  });

  it("requires TOTP for owners and admins but not agents or viewers", async () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      await expectAccessError(
        resolveTenant(
          prisma,
          { id: A.users[role].id, emailVerified: true, twoFactorEnabled: false },
          A.organization.slug,
        ),
        "two_factor_required",
      );
    }
    for (const role of ["AGENT", "VIEWER"] as const) {
      const ctx = await resolveTenant(
        prisma,
        { id: A.users[role].id, emailVerified: true, twoFactorEnabled: false },
        A.organization.slug,
      );
      expect(ctx.role).toBe(role);
    }
  });

  it("rejects unverified email addresses", async () => {
    await expectAccessError(
      resolveTenant(prisma, { id: A.users.AGENT.id, emailVerified: false }, A.organization.slug),
      "email_unverified",
    );
  });

  it("enforces the permission matrix for every role and permission", async () => {
    for (const role of ROLES) {
      for (const permission of PERMISSIONS) {
        const attempt = resolveTenant(
          prisma,
          { id: A.users[role].id, emailVerified: true, twoFactorEnabled: true },
          A.organization.slug,
          permission,
        );
        if (can(role, permission)) await expect(attempt).resolves.toMatchObject({ role });
        else await expectAccessError(attempt, "forbidden");
      }
    }
  });

  it("derives organizationId from the membership, never from input", async () => {
    const ctx = await ctxFor(A, "AGENT");
    expect(ctx.organizationId).toBe(A.organization.id);
  });
});

describe("tenant isolation: reads", () => {
  it("lists only the caller's organization's rows", async () => {
    const ctx = await ctxFor(A, "VIEWER");
    const conversations = await listConversations(ctx);
    const contacts = await listContacts(ctx);
    const leads = await listLeads(ctx);
    expect(conversations.items.map((c) => c.id)).toEqual([A.conversation.id]);
    expect(contacts.items.map((c) => c.id)).toEqual([A.contact.id]);
    expect(leads.map((l) => l.id)).toEqual([A.lead.id]);
  });

  it("returns null for another organization's IDs (manipulated identifiers)", async () => {
    const ctx = await ctxFor(A, "OWNER");
    expect(await getConversation(ctx, B.conversation.id)).toBeNull();
    expect(await getContact(ctx, B.contact.id)).toBeNull();
    expect(await getLead(ctx, B.lead.id)).toBeNull();
    // Its own records are visible.
    expect((await getConversation(ctx, A.conversation.id))?.messages).toHaveLength(1);
  });

  it("computes overview statistics from the caller's organization only", async () => {
    const stats = await getOverviewStats(await ctxFor(A, "VIEWER"));
    expect(stats).toMatchObject({
      conversations: { open: 1, pending: 0 },
      contacts: 1,
      leads: { active: 1, won: 0, lost: 0 },
      whatsappAccounts: 1,
    });
  });

  it("never exposes WhatsApp access tokens", async () => {
    const accounts = await listWhatsAppAccounts(await ctxFor(A, "ADMIN"));
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).not.toHaveProperty("accessTokenCiphertext");
    expect(accounts[0]?.hasAccessToken).toBe(true);
    expect(JSON.stringify(accounts)).not.toContain("v1:");
  });
});

describe("tenant isolation: writes", () => {
  it("cannot update another organization's conversation, contact or lead", async () => {
    const ctx = await ctxFor(A, "OWNER");
    await expect(setConversationStatus(ctx, B.conversation.id, "RESOLVED")).rejects.toThrow(
      /not found/,
    );
    await expect(disableConversationAi(ctx, B.conversation.id)).rejects.toThrow(/not found/);
    await expect(setContactOptOut(ctx, B.contact.id, true)).rejects.toThrow(/not found/);
    await expect(updateLead(ctx, B.lead.id, { title: "hijacked", status: "WON" })).rejects.toThrow(
      /not found/,
    );

    const [conv, contact, lead] = await Promise.all([
      prisma.conversation.findUniqueOrThrow({ where: { id: B.conversation.id } }),
      prisma.contact.findUniqueOrThrow({ where: { id: B.contact.id } }),
      prisma.lead.findUniqueOrThrow({ where: { id: B.lead.id } }),
    ]);
    expect(conv.status).toBe("OPEN");
    expect(conv.aiEnabled).toBe(true);
    expect(contact.optedOutAt).toBeNull();
    expect(lead.title).toBe("Test lead B");
  });

  it("cannot create a lead for another organization's contact", async () => {
    const ctx = await ctxFor(A, "AGENT");
    await expect(createLead(ctx, B.contact.id, { title: "x" })).rejects.toThrow(/not found/);
    expect(await prisma.lead.count({ where: { contactId: B.contact.id } })).toBe(1);
  });

  it("cannot assign a conversation to a user from another organization", async () => {
    const ctx = await ctxFor(A, "AGENT");
    await expect(assignConversation(ctx, A.conversation.id, B.users.AGENT.id)).rejects.toThrow(
      /not found/,
    );
    await assignConversation(ctx, A.conversation.id, A.users.AGENT.id);
    expect(
      (await prisma.conversation.findUniqueOrThrow({ where: { id: A.conversation.id } }))
        .assignedUserId,
    ).toBe(A.users.AGENT.id);
  });

  it("applies permitted writes to the caller's organization with audit entries", async () => {
    const ctx = await ctxFor(A, "AGENT");
    await setConversationStatus(ctx, A.conversation.id, "RESOLVED");
    const lead = await createLead(ctx, A.contact.id, {
      title: "Bulk order",
      status: "QUALIFIED",
      estimatedValue: "1500.50",
      currency: "usd",
    });
    const stored = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(stored.organizationId).toBe(A.organization.id);
    expect(stored.currency).toBe("USD");
    expect(stored.estimatedValue?.toString()).toBe("1500.5");

    const actions = (
      await prisma.auditLog.findMany({ where: { organizationId: A.organization.id } })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(["conversation.status_changed", "lead.created"]),
    );
    expect(await prisma.auditLog.count({ where: { organizationId: B.organization.id } })).toBe(0);
  });
});

describe("permissions on writes", () => {
  it("blocks viewers from every write", async () => {
    const ctx = await ctxFor(A, "VIEWER");
    await expectAccessError(setConversationStatus(ctx, A.conversation.id, "RESOLVED"), "forbidden");
    await expectAccessError(setContactOptOut(ctx, A.contact.id, true), "forbidden");
    await expectAccessError(createLead(ctx, A.contact.id, { title: "x" }), "forbidden");
    await expectAccessError(updateLead(ctx, A.lead.id, { title: "x" }), "forbidden");
  });

  it("restricts WhatsApp connection details to settings managers", async () => {
    await expectAccessError(listWhatsAppAccounts(await ctxFor(A, "AGENT")), "forbidden");
  });

  it("validates lead input", async () => {
    const ctx = await ctxFor(A, "AGENT");
    await expect(createLead(ctx, A.contact.id, { title: "" })).rejects.toThrow();
    await expect(
      createLead(ctx, A.contact.id, { title: "x", estimatedValue: "abc" }),
    ).rejects.toThrow();
    await expect(
      createLead(ctx, A.contact.id, { title: "x", currency: "dollars" }),
    ).rejects.toThrow();
  });
});
