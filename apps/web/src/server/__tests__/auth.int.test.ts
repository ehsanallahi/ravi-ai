import { prisma } from "@ravi/db";
import { resetTestDatabase } from "@ravi/testing";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AuthClient,
  createTestAuth,
  createVerifiedUser,
  linkFrom,
  type TestAuth,
  totpFromUri,
} from "./harness";

const PASSWORD = "correct-horse-battery-staple";

let auth: TestAuth;
let email: ReturnType<typeof createTestAuth>["email"];

beforeEach(async () => {
  await resetTestDatabase(prisma);
  ({ auth, email } = createTestAuth());
});

describe("registration is closed", () => {
  it("rejects public sign-up and creates no user", async () => {
    const client = new AuthClient(auth);
    const res = await client.request("/sign-up/email", {
      body: { email: "new@example.test", password: PASSWORD, name: "New" },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.user.count()).toBe(0);
  });
});

describe("sign-in and sessions", () => {
  it("signs in with a database-backed, HttpOnly, SameSite=Lax session cookie", async () => {
    const user = await createVerifiedUser("owner@example.test", PASSWORD);
    const client = new AuthClient(auth);
    const res = await client.signIn("owner@example.test", PASSWORD);
    expect(res.status).toBe(200);

    const sessionCookie = client.rawSetCookies.find((c) => c.startsWith("ravi.session_token="));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toMatch(/HttpOnly/i);
    expect(sessionCookie).toMatch(/SameSite=Lax/i);

    expect((await client.session())?.user.id).toBe(user.id);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
  });

  it("rejects a wrong password without revealing whether the account exists", async () => {
    await createVerifiedUser("owner@example.test", PASSWORD);
    const wrong = await new AuthClient(auth).signIn("owner@example.test", "wrong-password-123");
    const unknown = await new AuthClient(auth).signIn("nobody@example.test", "wrong-password-123");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.json?.message).toBe(unknown.json?.message);
  });

  it("invalidates the session on sign-out", async () => {
    await createVerifiedUser("owner@example.test", PASSWORD);
    const client = new AuthClient(auth);
    await client.signIn("owner@example.test", PASSWORD);
    const stolenCookie = client.cookieHeader();
    expect((await client.request("/sign-out", { body: {} })).status).toBe(200);
    expect(await client.session()).toBeNull();

    // Replaying the old cookie fails because the session row was deleted.
    const replay = await auth.api.getSession({ headers: new Headers({ cookie: stolenCookie }) });
    expect(replay).toBeNull();
    expect(await prisma.session.count()).toBe(0);
  });

  it("treats expired sessions as signed out", async () => {
    await createVerifiedUser("owner@example.test", PASSWORD);
    const client = new AuthClient(auth);
    await client.signIn("owner@example.test", PASSWORD);
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await client.session()).toBeNull();
  });

  it("rate-limits repeated sign-in attempts from the same client", async () => {
    await createVerifiedUser("owner@example.test", PASSWORD);
    const client = new AuthClient(auth);
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++)
      statuses.push((await client.signIn("owner@example.test", "nope-nope-nope")).status);
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(5)).toContain(429);
    // Even the correct password is blocked while limited.
    expect((await client.signIn("owner@example.test", PASSWORD)).status).toBe(429);
  });

  it("rejects state-changing requests from an untrusted origin (CSRF)", async () => {
    await createVerifiedUser("owner@example.test", PASSWORD);
    const client = new AuthClient(auth);
    await client.signIn("owner@example.test", PASSWORD);
    const attacker = new AuthClient(auth, "https://evil.example");
    // Same cookie, foreign Origin header.
    (attacker as unknown as { cookies: Map<string, string> }).cookies = new Map(
      client
        .cookieHeader()
        .split("; ")
        .map((p) => p.split("=") as [string, string]),
    );
    const res = await attacker.request("/sign-out", { body: {} });
    expect(res.status).toBe(403);
    expect(await client.session()).not.toBeNull();
  });
});

describe("email verification", () => {
  it("blocks unverified accounts, emails a link, and allows sign-in after verifying", async () => {
    await createVerifiedUser("new@example.test", PASSWORD, { emailVerified: false });
    const client = new AuthClient(auth);
    const blocked = await client.signIn("new@example.test", PASSWORD);
    expect(blocked.status).toBe(403);

    const message = email.last("verify-email");
    expect(message?.to).toBe("new@example.test");
    const verify = await client.request(linkFrom(message!.text));
    expect([200, 302]).toContain(verify.status);

    expect(
      (await prisma.user.findUniqueOrThrow({ where: { email: "new@example.test" } })).emailVerified,
    ).toBe(true);
    expect((await new AuthClient(auth).signIn("new@example.test", PASSWORD)).status).toBe(200);
  });
});

describe("password reset", () => {
  it("resets via emailed token, revokes sessions, and notifies the user", async () => {
    await createVerifiedUser("owner@example.test", PASSWORD);
    const existing = new AuthClient(auth);
    await existing.signIn("owner@example.test", PASSWORD);

    const requester = new AuthClient(auth);
    const req = await requester.request("/request-password-reset", {
      body: { email: "owner@example.test", redirectTo: "/reset-password" },
    });
    expect(req.status).toBe(200);
    // Unknown emails get the same response (no account enumeration).
    const unknown = await requester.request("/request-password-reset", {
      body: { email: "nobody@example.test", redirectTo: "/reset-password" },
    });
    expect(unknown.status).toBe(200);
    expect(email.sent.filter((m) => m.kind === "reset-password")).toHaveLength(1);

    // The emailed link redirects to /reset-password?token=...
    const link = await requester.request(linkFrom(email.last("reset-password")!.text));
    const token = new URL(link.headers.get("location")!, "http://localhost").searchParams.get(
      "token",
    );
    expect(token).toBeTruthy();

    const newPassword = "a-brand-new-long-password";
    const reset = await requester.request("/reset-password", { body: { token, newPassword } });
    expect(reset.status).toBe(200);
    expect(email.last("password-changed")?.to).toBe("owner@example.test");

    expect(await existing.session()).toBeNull();
    expect((await new AuthClient(auth).signIn("owner@example.test", PASSWORD)).status).toBe(401);
    expect((await new AuthClient(auth).signIn("owner@example.test", newPassword)).status).toBe(200);

    // Tokens are single-use.
    const again = await requester.request("/reset-password", {
      body: { token, newPassword: "yet-another-password" },
    });
    expect(again.status).toBeGreaterThanOrEqual(400);
  });

  it("enforces the minimum password length", async () => {
    await createVerifiedUser("owner@example.test", PASSWORD);
    await expect(createVerifiedUser("short@example.test", "short")).rejects.toThrow(/at least 12/);
  });
});

describe("TOTP two-factor authentication", () => {
  it("enables TOTP after verifying a code, then requires it at sign-in", async () => {
    const user = await createVerifiedUser("owner@example.test", PASSWORD);
    const client = new AuthClient(auth);
    await client.signIn("owner@example.test", PASSWORD);

    const enable = await client.request("/two-factor/enable", { body: { password: PASSWORD } });
    expect(enable.status).toBe(200);
    const totpURI = enable.json?.totpURI as string;
    expect(totpURI).toMatch(/^otpauth:\/\/totp\//);
    expect((enable.json?.backupCodes as string[]).length).toBe(10);
    // Not enabled until a valid code proves the authenticator works.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).twoFactorEnabled).toBe(
      false,
    );

    const totp = totpFromUri(totpURI);
    expect(
      (await client.request("/two-factor/verify-totp", { body: { code: totp.generate() } })).status,
    ).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).twoFactorEnabled).toBe(
      true,
    );
    // The secret is stored encrypted, never as the plain base32 secret.
    const stored = await prisma.twoFactor.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.secret).not.toContain(new URL(totpURI).searchParams.get("secret")!);

    // A fresh sign-in now stops at the second factor.
    const second = new AuthClient(auth);
    const signIn = await second.signIn("owner@example.test", PASSWORD);
    expect(signIn.status).toBe(200);
    expect(signIn.json?.twoFactorRedirect).toBe(true);
    expect(await second.session()).toBeNull();

    const bad = await second.request("/two-factor/verify-totp", { body: { code: "000000" } });
    expect(bad.status).toBe(401);
    expect(await second.session()).toBeNull();

    const good = await second.request("/two-factor/verify-totp", {
      body: { code: totp.generate() },
    });
    expect(good.status).toBe(200);
    expect((await second.session())?.user.twoFactorEnabled).toBe(true);
  });

  it("requires the account password to enable TOTP", async () => {
    await createVerifiedUser("owner@example.test", PASSWORD);
    const client = new AuthClient(auth);
    await client.signIn("owner@example.test", PASSWORD);
    const res = await client.request("/two-factor/enable", {
      body: { password: "wrong-password-123" },
    });
    expect(res.status).toBe(400);
  });
});

describe("production hardening", () => {
  it("caps sign-in attempts per account even when the attacker rotates IPs", async () => {
    await createVerifiedUser("owner@example.test", PASSWORD);
    const statuses: number[] = [];
    // A fresh client (new IP) per attempt, so the per-IP limit never triggers.
    for (let i = 0; i < 12; i++) {
      statuses.push(
        (await new AuthClient(auth).signIn("owner@example.test", "guess-guess-guess")).status,
      );
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    // The limit is per account: other accounts are unaffected.
    await createVerifiedUser("other@example.test", PASSWORD);
    expect((await new AuthClient(auth).signIn("other@example.test", PASSWORD)).status).toBe(200);
    // Email case and whitespace don't create separate buckets.
    expect((await new AuthClient(auth).signIn(" OWNER@example.test ", PASSWORD)).status).toBe(429);
  });

  it("caps password-reset emails per account across IPs", async () => {
    await createVerifiedUser("owner@example.test", PASSWORD);
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push(
        (
          await new AuthClient(auth).request("/request-password-reset", {
            body: { email: "owner@example.test", redirectTo: "/reset-password" },
          })
        ).status,
      );
    }
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
    expect(email.sent.filter((m) => m.kind === "reset-password")).toHaveLength(5);
  });

  it("refuses 'trust this device', so required 2FA can't be skipped for 30 days", async () => {
    await createVerifiedUser("owner@example.test", PASSWORD);
    const setup = new AuthClient(auth);
    await setup.signIn("owner@example.test", PASSWORD);
    const enable = await setup.request("/two-factor/enable", { body: { password: PASSWORD } });
    const totp = totpFromUri(enable.json?.totpURI as string);
    await setup.request("/two-factor/verify-totp", { body: { code: totp.generate() } });

    const client = new AuthClient(auth);
    await client.signIn("owner@example.test", PASSWORD);
    const trusted = await client.request("/two-factor/verify-totp", {
      body: { code: totp.generate(), trustDevice: true },
    });
    expect(trusted.status).toBe(400);
    expect(client.rawSetCookies.some((c) => /trust/i.test(c))).toBe(false);
    expect(await client.session()).toBeNull();
  });

  it("disables auth endpoints the app does not use", async () => {
    await createVerifiedUser("owner@example.test", PASSWORD);
    const client = new AuthClient(auth);
    await client.signIn("owner@example.test", PASSWORD);
    for (const path of [
      "/delete-user",
      "/change-email",
      "/update-user",
      "/sign-in/social",
      "/list-accounts",
    ]) {
      const res = await client.request(path, {
        body: { newEmail: "x@example.test", provider: "google" },
      });
      expect(res.status, path).toBe(404);
    }
    expect(await prisma.user.count()).toBe(1);
  });
});
