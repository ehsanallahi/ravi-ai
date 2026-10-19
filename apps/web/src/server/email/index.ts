import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createLogger } from "@ravi/core";
import type { AuthEnv } from "@ravi/validation";
import { Resend } from "resend";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Machine-readable category, used by tests and the local outbox (never sent). */
  kind: "verify-email" | "reset-password" | "invitation" | "password-changed";
}

export interface EmailSender {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

const log = createLogger({ service: "web", component: "email" });

/** Production adapter. Requires a verified sending domain in Resend. */
export class ResendEmailSender implements EmailSender {
  readonly name = "resend";
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(message: EmailMessage): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    if (error) throw new Error(`Resend rejected the email: ${error.message}`);
  }
}

/**
 * Local development adapter. Writes each email as a JSON file to .data/outbox (git-ignored)
 * instead of sending it, and logs the subject and recipient so links can be opened locally.
 */
export class OutboxEmailSender implements EmailSender {
  readonly name = "outbox";

  constructor(private readonly dir: string) {}

  async send(message: EmailMessage): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, `${Date.now()}-${message.kind}.json`);
    await writeFile(
      file,
      JSON.stringify({ ...message, createdAt: new Date().toISOString() }, null, 2),
    );
    log.info("email written to local outbox (not sent)", {
      kind: message.kind,
      to: message.to,
      file: path.relative(process.cwd(), file),
    });
  }
}

/** Test adapter: keeps emails in memory. */
export class MemoryEmailSender implements EmailSender {
  readonly name = "memory";
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }

  last(kind?: EmailMessage["kind"]): EmailMessage | undefined {
    return [...this.sent].reverse().find((m) => !kind || m.kind === kind);
  }
}

export function findRepoRoot(start = process.cwd()): string {
  // apps/web → repo root; works for `next dev` (cwd apps/web) and scripts run from the root.
  return path.basename(start) === "web" ? path.resolve(start, "../..") : start;
}

export function createEmailSender(env: AuthEnv): EmailSender {
  if (env.EMAIL_PROVIDER === "resend") {
    return new ResendEmailSender(env.RESEND_API_KEY!, env.EMAIL_FROM!);
  }
  if (env.NODE_ENV === "production") {
    throw new Error("The local outbox email adapter cannot be used in production");
  }
  return new OutboxEmailSender(path.join(findRepoRoot(), ".data", "outbox"));
}
