/**
 * Posts ONE signed, fictional inbound WhatsApp text message to the LOCAL webhook, exactly as Meta
 * would (same payload shape and X-Hub-Signature-256 header). Use it to test the webhook, worker,
 * tenant routing and AI drafts before connecting Meta. Nothing is sent to WhatsApp.
 *
 *   pnpm whatsapp:simulate -- --text "Lahore mein delivery kitne din mein hogi?"
 *   pnpm whatsapp:simulate -- --text "..." --repeat-id wamid.SIM_...   # redelivery (idempotency)
 *
 * Needs the web app running (pnpm dev) and the worker running to process the event. The sender is
 * a fictional number (+1 555 000 0199); the message goes to WHATSAPP_PHONE_NUMBER_ID, which must be
 * registered (pnpm --filter @ravi/db account:register). Only localhost targets are allowed.
 */
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { signWebhookBody } from "@ravi/whatsapp";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    text: { type: "string", default: "Hello, what are your opening hours?" },
    url: { type: "string", default: "http://localhost:3000/api/webhooks/whatsapp" },
    "repeat-id": { type: "string" },
    from: { type: "string", default: "15550000199" },
  },
});

async function main() {
  const url = new URL(values.url);
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
    throw new Error("Refusing to post to a non-local URL. Real traffic must come from Meta.");
  }
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!appSecret) throw new Error("Set WHATSAPP_APP_SECRET in .env");
  if (!phoneNumberId || !/^\d+$/.test(phoneNumberId)) {
    throw new Error("Set WHATSAPP_PHONE_NUMBER_ID in .env");
  }
  if (!/^1555\d{7}$/.test(values.from)) {
    throw new Error("--from must be a fictional +1 555 number (e.g. 15550000199)");
  }

  const messageId = values["repeat-id"] ?? `wamid.SIM_${randomUUID().replace(/-/g, "")}`;
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() || "0",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550000000", phone_number_id: phoneNumberId },
              contacts: [{ profile: { name: "Simulated Customer" }, wa_id: values.from }],
              messages: [
                {
                  from: values.from,
                  id: messageId,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: values.text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const body = JSON.stringify(payload);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": signWebhookBody(body, appSecret),
    },
    body,
  });
  console.log(`POST ${url.pathname} → ${res.status} ${await res.text()}`);
  console.log(`message id: ${messageId} (re-send with --repeat-id to test idempotency)`);
  if (!res.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
