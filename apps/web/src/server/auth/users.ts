import { randomUUID } from "node:crypto";
import type { Prisma } from "@ravi/db";
import { hashPassword } from "better-auth/crypto";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./constants";

export class UserInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserInputError";
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function assertValidPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new UserInputError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new UserInputError(`Password must be at most ${MAX_PASSWORD_LENGTH} characters`);
  }
}

/**
 * Creates a user with an email/password credential inside the caller's transaction.
 * This is the only account-creation path. Public sign-up is disabled in Better Auth, and this
 * runs only from the owner CLI or a valid invitation.
 */
export async function createCredentialUser(
  tx: Prisma.TransactionClient,
  input: { email: string; name: string; password: string; emailVerified: boolean },
) {
  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserInputError("Invalid email address");
  if (!name || name.length > 120) throw new UserInputError("Name is required (max 120 characters)");
  assertValidPassword(input.password);

  if (await tx.user.findUnique({ where: { email }, select: { id: true } })) {
    throw new UserInputError("An account with this email already exists");
  }

  const user = await tx.user.create({
    data: { id: randomUUID(), email, name, emailVerified: input.emailVerified },
  });
  await tx.account.create({
    data: {
      id: randomUUID(),
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: await hashPassword(input.password),
    },
  });
  return user;
}
