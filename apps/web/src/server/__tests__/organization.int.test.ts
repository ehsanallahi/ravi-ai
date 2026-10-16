import { prisma } from "@ravi/db";
import { createTenantFixture, resetTestDatabase, type TenantFixture } from "@ravi/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryEmailSender } from "../email";
import { changeMemberRole, listMembers, removeMember } from "../services/members";
import {
  acceptInvitationAsNewUser,
  acceptInvitationAsUser,
  createInvitation,
  INVITATION_TTL_MS,
  listPendingInvitations,
  lookupInvitation,
  revokeInvitation,
} from "../services/invitations";
import { createOrganizationWithOwner, updateOrganizationSettings } from "../services/organizations";
import { resolveTenant, TenantAccessError, type TenantContext } from "../tenancy/context";
import { AuthClient, BASE_URL, createTestAuth, linkFrom } from "./harness";

let A: TenantFixture;
let B: TenantFixture;
let email: MemoryEmailSender;

async function ctxFor(
  f: TenantFixture,
  role: keyof TenantFixture["users"],
): Promise<TenantContext> {
  return resolveTenant(
    prisma,
    { id: f.users[role].id, emailVerified: true, twoFactorEnabled: true },
    f.organization.slug,
  );
}

async function membershipId(f: TenantFixture, role: keyof TenantFixture["users"]) {
  return (
    await prisma.membership.findFirstOrThrow({
      where: { organizationId: f.organization.id, userId: f.users[role].id },
    })
  ).id;
}

function tokenFrom(url: string) {
  return url.split("/invite/")[1]!;
}

beforeEach(async () => {
  await resetTestDatabase(prisma);
  A = await createTenantFixture(prisma, "A");
  B = await createTenantFixture(prisma, "B");
  email = new MemoryEmailSender();
});

describe("organizations", () => {
  it("creates an organization with its owner, and rejects reserved or duplicate slugs", async () => {
    const owner = await prisma.user.create({
      data: { id: "u-new", email: "solo@example.test", name: "Solo" },
    });
    const org = await prisma.$transaction((tx) =>
      createOrganizationWithOwner(tx, {
        name: "Solo Shop",
        slug: "solo-shop",
        ownerUserId: owner.id,
      }),
    );
    expect(
      await prisma.membership.findFirst({
        where: { organizationId: org.id, userId: owner.id, role: "OWNER" },
      }),
    ).not.toBeNull();
    await expect(
      prisma.$transaction((tx) =>
        createOrganizationWithOwner(tx, { name: "Dup", slug: "solo-shop", ownerUserId: owner.id }),
      ),
    ).rejects.toThrow(/already exists/);
    await expect(
      prisma.$transaction((tx) =>
        createOrganizationWithOwner(tx, { name: "Api", slug: "api", ownerUserId: owner.id }),
      ),
    ).rejects.toThrow(/reserved/);
  });

  it("lets owners and admins update settings, but not agents", async () => {
    await updateOrganizationSettings(await ctxFor(A, "ADMIN"), {
      name: "Renamed A",
      timezone: "Asia/Karachi",
    });
    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { id: A.organization.id } })).timezone,
    ).toBe("Asia/Karachi");
    await expect(
      updateOrganizationSettings(await ctxFor(A, "AGENT"), { name: "x", timezone: "UTC" }),
    ).rejects.toBeInstanceOf(TenantAccessError);
    await expect(
      updateOrganizationSettings(await ctxFor(A, "OWNER"), {
        name: "Ok",
        timezone: "Mars/Olympus",
      }),
    ).rejects.toThrow(/time zone/);
    // AI auto-reply cannot be enabled through settings.
    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { id: A.organization.id } }))
        .aiAutoReplyEnabled,
    ).toBe(false);
  });
});

describe("members and roles", () => {
  it("lists only the organization's members", async () => {
    const members = await listMembers(await ctxFor(A, "VIEWER"));
    expect(members).toHaveLength(4);
    expect(members.every((m) => m.user.email.includes(".a."))).toBe(true);
  });

  it("lets admins change non-owner roles but never grant or change OWNER", async () => {
    const admin = await ctxFor(A, "ADMIN");
    await changeMemberRole(admin, await membershipId(A, "VIEWER"), "AGENT");
    await expect(changeMemberRole(admin, await membershipId(A, "AGENT"), "OWNER")).rejects.toThrow(
      /owner/i,
    );
    await expect(changeMemberRole(admin, await membershipId(A, "OWNER"), "VIEWER")).rejects.toThrow(
      /owner/i,
    );
  });

  it("blocks agents and viewers from managing members", async () => {
    await expect(
      changeMemberRole(await ctxFor(A, "AGENT"), await membershipId(A, "VIEWER"), "ADMIN"),
    ).rejects.toBeInstanceOf(TenantAccessError);
    await expect(
      removeMember(await ctxFor(A, "VIEWER"), await membershipId(A, "AGENT")),
    ).rejects.toBeInstanceOf(TenantAccessError);
  });

  it("protects the last owner from demotion and removal", async () => {
    const owner = await ctxFor(A, "OWNER");
    const ownerMembership = await membershipId(A, "OWNER");
    await expect(changeMemberRole(owner, ownerMembership, "ADMIN")).rejects.toThrow(
      /at least one owner/,
    );
    await expect(removeMember(owner, ownerMembership)).rejects.toThrow(/at least one owner/);

    // With a second owner, the first may step down.
    await changeMemberRole(owner, await membershipId(A, "ADMIN"), "OWNER");
    await changeMemberRole(owner, ownerMembership, "ADMIN");
    expect(
      await prisma.membership.count({
        where: { organizationId: A.organization.id, role: "OWNER" },
      }),
    ).toBe(1);
  });

  it("keeps an owner even under concurrent demotions", async () => {
    const owner = await ctxFor(A, "OWNER");
    await changeMemberRole(owner, await membershipId(A, "ADMIN"), "OWNER");
    const [o1, o2] = [await membershipId(A, "OWNER"), await membershipId(A, "ADMIN")];
    const results = await Promise.allSettled([
      changeMemberRole(owner, o1, "AGENT"),
      changeMemberRole(owner, o2, "AGENT"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await prisma.membership.count({
        where: { organizationId: A.organization.id, role: "OWNER" },
      }),
    ).toBe(1);
  });

  it("cannot touch memberships of another organization", async () => {
    const owner = await ctxFor(A, "OWNER");
    await expect(changeMemberRole(owner, await membershipId(B, "AGENT"), "VIEWER")).rejects.toThrow(
      /not found/,
    );
    await expect(removeMember(owner, await membershipId(B, "AGENT"))).rejects.toThrow(/not found/);
    expect(await prisma.membership.count({ where: { organizationId: B.organization.id } })).toBe(4);
  });

  it("removes members, lets members leave, unassigns their conversations, and audits it", async () => {
    await prisma.conversation.update({
      where: { id: A.conversation.id },
      data: { assignedUserId: A.users.AGENT.id },
    });
    await removeMember(await ctxFor(A, "ADMIN"), await membershipId(A, "AGENT"));
    expect(
      (await prisma.conversation.findUniqueOrThrow({ where: { id: A.conversation.id } }))
        .assignedUserId,
    ).toBeNull();

    await removeMember(await ctxFor(A, "VIEWER"), await membershipId(A, "VIEWER")); // leaves
    const actions = (
      await prisma.auditLog.findMany({ where: { organizationId: A.organization.id } })
    ).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["member.removed", "member.left"]));
    // The removed agent can no longer access the organization.
    await expect(
      resolveTenant(
        prisma,
        { id: A.users.AGENT.id, emailVerified: true, twoFactorEnabled: true },
        A.organization.slug,
      ),
    ).rejects.toBeInstanceOf(TenantAccessError);
  });
});

describe("invitations", () => {
  const deps = () => ({ email, baseUrl: BASE_URL });

  it("emails a single-use link and stores only a hash of the token", async () => {
    const { url } = await createInvitation(
      await ctxFor(A, "ADMIN"),
      { email: "New.Person@Example.test", role: "AGENT" },
      deps(),
    );
    const message = email.last("invitation");
    expect(message?.to).toBe("new.person@example.test");
    expect(linkFrom(message!.text)).toBe(url);

    const token = tokenFrom(url);
    const stored = await prisma.invitation.findFirstOrThrow({
      where: { organizationId: A.organization.id },
    });
    expect(stored.tokenHash).not.toContain(token);
    expect(JSON.stringify(stored)).not.toContain(token);
    expect((await listPendingInvitations(await ctxFor(A, "OWNER"))).map((i) => i.email)).toEqual([
      "new.person@example.test",
    ]);
  });

  it("creates the account and membership for a new person, then cannot be reused", async () => {
    const { url } = await createInvitation(
      await ctxFor(A, "OWNER"),
      { email: "newbie@example.test", role: "AGENT" },
      deps(),
    );
    const token = tokenFrom(url);
    expect(await lookupInvitation(token)).toMatchObject({ status: "valid", accountExists: false });

    const result = await acceptInvitationAsNewUser(token, {
      name: "New Bie",
      password: "a-long-enough-password",
    });
    expect(result).toMatchObject({ organizationSlug: A.organization.slug, role: "AGENT" });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "newbie@example.test" } });
    expect(user.emailVerified).toBe(true);

    // The new account can sign in through Better Auth with the chosen password.
    const { auth } = createTestAuth();
    expect(
      (await new AuthClient(auth).signIn("newbie@example.test", "a-long-enough-password")).status,
    ).toBe(200);

    expect(await lookupInvitation(token)).toEqual({ status: "used" });
    await expect(
      acceptInvitationAsNewUser(token, { name: "Again", password: "a-long-enough-password" }),
    ).rejects.toThrow();
    expect(await prisma.auditLog.count({ where: { action: "invitation.accepted" } })).toBe(1);
  });

  it("requires the signed-in user's email to match the invitation", async () => {
    const { url } = await createInvitation(
      await ctxFor(A, "OWNER"),
      { email: B.users.AGENT.email, role: "VIEWER" },
      deps(),
    );
    const token = tokenFrom(url);
    await expect(
      acceptInvitationAsUser(token, { id: B.users.VIEWER.id, email: B.users.VIEWER.email }),
    ).rejects.toThrow(/different email/);
    const ok = await acceptInvitationAsUser(token, {
      id: B.users.AGENT.id,
      email: B.users.AGENT.email,
    });
    expect(ok.organizationSlug).toBe(A.organization.slug);
    // The same person now belongs to both organizations, with separate roles.
    const memberships = await prisma.membership.findMany({ where: { userId: B.users.AGENT.id } });
    expect(memberships.map((m) => m.role).sort()).toEqual(["AGENT", "VIEWER"]);
  });

  it("rejects new-account acceptance when the email already has an account", async () => {
    const { url } = await createInvitation(
      await ctxFor(A, "OWNER"),
      { email: B.users.AGENT.email, role: "VIEWER" },
      deps(),
    );
    await expect(
      acceptInvitationAsNewUser(tokenFrom(url), { name: "x", password: "a-long-enough-password" }),
    ).rejects.toThrow(/Sign in/);
  });

  it("rejects expired, revoked, replaced and unknown tokens", async () => {
    const owner = await ctxFor(A, "OWNER");
    const past = new Date(Date.now() - INVITATION_TTL_MS - 60_000);
    const expired = await createInvitation(
      owner,
      { email: "late@example.test", role: "AGENT" },
      { ...deps(), now: past },
    );
    expect(await lookupInvitation(tokenFrom(expired.url))).toEqual({ status: "expired" });
    await expect(
      acceptInvitationAsNewUser(tokenFrom(expired.url), {
        name: "x",
        password: "a-long-enough-password",
      }),
    ).rejects.toThrow(/invalid or has expired/);

    const revoked = await createInvitation(
      owner,
      { email: "rev@example.test", role: "AGENT" },
      deps(),
    );
    await revokeInvitation(owner, revoked.id);
    expect(await lookupInvitation(tokenFrom(revoked.url))).toEqual({ status: "invalid" });

    const first = await createInvitation(
      owner,
      { email: "twice@example.test", role: "AGENT" },
      deps(),
    );
    await createInvitation(owner, { email: "twice@example.test", role: "VIEWER" }, deps());
    expect(await lookupInvitation(tokenFrom(first.url))).toEqual({ status: "invalid" });

    expect(await lookupInvitation("x".repeat(43))).toEqual({ status: "invalid" });
    expect(await lookupInvitation("short")).toEqual({ status: "invalid" });
    expect(
      await prisma.user.count({
        where: { email: { in: ["late@example.test", "rev@example.test"] } },
      }),
    ).toBe(0);
  });

  it("accepts a token only once under concurrent requests", async () => {
    const { url } = await createInvitation(
      await ctxFor(A, "OWNER"),
      { email: B.users.VIEWER.email, role: "AGENT" },
      deps(),
    );
    const user = { id: B.users.VIEWER.id, email: B.users.VIEWER.email };
    const results = await Promise.allSettled([
      acceptInvitationAsUser(tokenFrom(url), user),
      acceptInvitationAsUser(tokenFrom(url), user),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await prisma.membership.count({
        where: { organizationId: A.organization.id, userId: user.id },
      }),
    ).toBe(1);
  });

  it("enforces who may invite whom", async () => {
    await expect(
      createInvitation(
        await ctxFor(A, "ADMIN"),
        { email: "boss@example.test", role: "OWNER" },
        deps(),
      ),
    ).rejects.toThrow(/owner/i);
    await expect(
      createInvitation(
        await ctxFor(A, "AGENT"),
        { email: "friend@example.test", role: "VIEWER" },
        deps(),
      ),
    ).rejects.toBeInstanceOf(TenantAccessError);
    await expect(
      createInvitation(
        await ctxFor(A, "OWNER"),
        { email: A.users.AGENT.email, role: "VIEWER" },
        deps(),
      ),
    ).rejects.toThrow(/already a member/);
    const otherOrg = await createInvitation(
      await ctxFor(A, "OWNER"),
      { email: "x@example.test", role: "AGENT" },
      deps(),
    );
    await expect(revokeInvitation(await ctxFor(B, "OWNER"), otherOrg.id)).rejects.toThrow(
      /not found/,
    );
    expect(email.sent.filter((m) => m.kind === "invitation")).toHaveLength(1);
  });
});
