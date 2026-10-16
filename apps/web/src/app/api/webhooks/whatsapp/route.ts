import { createLogger, JOB_TYPES } from "@ravi/core";
import { type Prisma, prisma } from "@ravi/db";
import { webhookEnvSchema } from "@ravi/validation";
import {
  handleWebhookEvent,
  handleWebhookVerification,
  type WebhookDeps,
} from "@/server/whatsapp-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger({ service: "web", route: "whatsapp-webhook" });

const deps: WebhookDeps = {
  getConfig() {
    const parsed = webhookEnvSchema.safeParse(process.env);
    if (!parsed.success) {
      log.error("webhook env invalid", {
        variables: parsed.error.issues.map((i) => i.path.join(".")),
      });
      return null;
    }
    return {
      verifyToken: parsed.data.WHATSAPP_VERIFY_TOKEN,
      appSecret: parsed.data.WHATSAPP_APP_SECRET,
    };
  },
  async enqueue({ dedupeKey, payload }) {
    await prisma.job.createMany({
      data: [
        {
          type: JOB_TYPES.whatsappWebhook,
          dedupeKey,
          payload: payload as Prisma.InputJsonValue,
        },
      ],
      skipDuplicates: true,
    });
  },
  log,
};

export function GET(request: Request) {
  return handleWebhookVerification(new URL(request.url), deps);
}

export function POST(request: Request) {
  return handleWebhookEvent(request, deps);
}
