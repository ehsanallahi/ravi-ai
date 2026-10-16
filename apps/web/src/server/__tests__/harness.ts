import { prisma } from "@ravi/db";
import type { AuthEnv } from "@ravi/validation";
import { TOTP } from "otpauth";
import { createAuth } from "../auth/auth";
import { createCredentialUser } from "../auth/users";
import { MemoryEmailSender } from "../email";

export const BASE_URL = "http://localhost:3000";

export const TEST_AUTH_ENV: AuthEnv = {
  NODE_ENV: "test",
  BETTER_AUTH_SECRET: "integration-test-secret-not-used-anywhere-else-0123456789",
  BETTER_AUTH_URL: BASE_URL,
  REGISTRATION_MODE: "closed",
  EMAIL_PROVIDER: "outbox",
  AUTH_IP_HEADERS: ["x-forwarded-for"],
};

export function createTestAuth() {
  const email = new MemoryEmailSender();
  const auth = createAuth({ env: TEST_AUTH_ENV, email, prisma, nextJsCookies: false });
  return { auth, email };
}

export type TestAuth = ReturnType<typeof createTestAuth>["auth"];

let ipCounter = 1;

/** A browser-like client: keeps a cookie jar and sends same-origin requests through auth.handler. */
export class AuthClient {
  private readonly cookies = new Map<string, string>();
  readonly ip = `10.0.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`;

  constructor(
    private readonly auth: TestAuth,
    private readonly origin = BASE_URL,
  ) {}

  cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  headers(): Headers {
    return new Headers({ cookie: this.cookieHeader(), "x-forwarded-for": this.ip });
  }

  rawSetCookies: string[] = [];

  async request(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}) {
    const method = init.method ?? (init.body === undefined ? "GET" : "POST");
    const headers = new Headers({ origin: this.origin, "x-forwarded-for": this.ip });
    if (this.cookies.size) headers.set("cookie", this.cookieHeader());
    if (init.body !== undefined) headers.set("content-type", "application/json");
    const url = path.startsWith("http") ? path : `${BASE_URL}/api/auth${path}`;
    const res = await this.auth.handler(
      new Request(url, {
        method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        redirect: "manual",
      }),
    );
    this.rawSetCookies = res.headers.getSetCookie();
    for (const cookie of this.rawSetCookies) {
      const [pair, ...attrs] = cookie.split(";");
      const idx = pair!.indexOf("=");
      const name = pair!.slice(0, idx).trim();
      const value = pair!.slice(idx + 1).trim();
      const expired = attrs.some((a) => /max-age=0/i.test(a.trim()));
      if (!value || expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return {
      status: res.status,
      json: json as Record<string, unknown> | null,
      headers: res.headers,
    };
  }

  signIn(email: string, password: string) {
    return this.request("/sign-in/email", { body: { email, password } });
  }

  async session() {
    const res = await this.request("/get-session");
    return res.json as { user: { id: string; email: string; twoFactorEnabled: boolean } } | null;
  }
}

export async function createVerifiedUser(
  email: string,
  password: string,
  options: { emailVerified?: boolean; name?: string } = {},
) {
  return prisma.$transaction((tx) =>
    createCredentialUser(tx, {
      email,
      name: options.name ?? "Test User",
      password,
      emailVerified: options.emailVerified ?? true,
    }),
  );
}

export function totpFromUri(uri: string): TOTP {
  const url = new URL(uri);
  return new TOTP({
    secret: url.searchParams.get("secret")!,
    digits: Number(url.searchParams.get("digits") ?? 6),
    period: Number(url.searchParams.get("period") ?? 30),
  });
}

/** Extracts the first link from an email body. */
export function linkFrom(text: string): string {
  const match = text.match(/https?:\/\/\S+/);
  if (!match) throw new Error("No link in email");
  return match[0];
}
