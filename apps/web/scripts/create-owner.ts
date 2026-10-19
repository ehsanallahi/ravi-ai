/**
 * First-owner setup. Creates an owner account, their organization and the OWNER membership in
 * one transaction, then emails a verification link.
 *
 *   pnpm --filter @ravi/web owner:create --email you@company.com --name "Your Name" \
 *     --org-name "Your Business" --org-slug your-business
 *
 * - The password is typed at a hidden prompt (or piped on stdin). It is never accepted as a
 *   command-line argument, which would leave it in shell history and process listings.
 * - By default it refuses to run once any user exists: further people join through invitations.
 *   Pass --additional-organization to create another organization with a new owner deliberately.
 * - After verifying their email and signing in, the owner must set up TOTP before they can
 *   access the organization.
 */
import { parseArgs } from "node:util";
import { prisma } from "@ravi/db";
import { authEnvSchema, parseEnv } from "@ravi/validation";
import { createAuth } from "../src/server/auth/auth";
import {
  assertValidPassword,
  createCredentialUser,
  normalizeEmail,
} from "../src/server/auth/users";
import { createEmailSender } from "../src/server/email";
import { createOrganizationWithOwner } from "../src/server/services/organizations";

function readHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    // Piped input: read the first line.
    return new Promise((resolve, reject) => {
      let data = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (chunk) => (data += chunk));
      stdin.on("end", () => resolve(data.split(/\r?\n/)[0] ?? ""));
      stdin.on("error", reject);
    });
  }
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (char: string) => {
      if (char === "\r" || char === "\n" || char === "\u0004") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off("data", onData);
        process.stdout.write("\n");
        resolve(value);
      } else if (char === "\u0003") {
        process.stdout.write("\n");
        process.exit(130);
      } else if (char === "\u007f" || char === "\b") {
        value = value.slice(0, -1);
      } else {
        value += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
      "org-name": { type: "string" },
      "org-slug": { type: "string" },
      "additional-organization": { type: "boolean", default: false },
    },
  });
  const email = values.email ? normalizeEmail(values.email) : "";
  const name = values.name?.trim() ?? "";
  const orgName = values["org-name"]?.trim() ?? "";
  const orgSlug = values["org-slug"]?.trim().toLowerCase() ?? "";
  if (!email || !name || !orgName || !orgSlug) {
    throw new Error("Required: --email, --name, --org-name, --org-slug");
  }

  const env = parseEnv(authEnvSchema);
  if ((await prisma.user.count()) > 0 && !values["additional-organization"]) {
    throw new Error(
      "Users already exist. Invite people from Team settings instead, or pass --additional-organization to create a separate organization with a new owner.",
    );
  }

  const password = await readHidden("Owner password (min 12 characters, hidden): ");
  assertValidPassword(password);
  if (process.stdin.isTTY) {
    const confirm = await readHidden("Confirm password: ");
    if (confirm !== password) throw new Error("Passwords do not match");
  }

  const { user, organization } = await prisma.$transaction(async (tx) => {
    const user = await createCredentialUser(tx, { email, name, password, emailVerified: false });
    const organization = await createOrganizationWithOwner(tx, {
      name: orgName,
      slug: orgSlug,
      ownerUserId: user.id,
    });
    return { user, organization };
  });

  const emailSender = createEmailSender(env);
  const auth = createAuth({ env, email: emailSender, nextJsCookies: false });
  await auth.api.sendVerificationEmail({
    body: { email: user.email, callbackURL: "/login?verified=1" },
  });

  console.log(
    `\nCreated owner ${user.email} for organization "${organization.name}" (/o/${organization.slug}).`,
  );
  console.log(
    emailSender.name === "outbox"
      ? "A verification email was written to .data/outbox (local outbox; nothing was sent)."
      : `A verification email was sent via ${emailSender.name}.`,
  );
  console.log(
    "Next: verify the email, sign in, then set up two-factor authentication (required for owners).",
  );
}

main()
  .catch((err) => {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
