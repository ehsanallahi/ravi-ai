import { createLogger } from "@ravi/core";
import { signWebhookBody } from "@ravi/whatsapp";
import { textMessagePayload } from "@ravi/whatsapp/fixtures";
import { describe, expect, it, vi } from "vitest";
import {
  handleWebhookEvent,
  handleWebhookVerification,
  MAX_WEBHOOK_BODY_BYTES,
  type WebhookDeps,
} from "./whatsapp-webhook";

const config = { verifyToken: "verify-token-0123456789", appSecret: "app-secret" };
const URL_BASE = "https://example.test/api/webhooks/whatsapp";

function deps(overrides: Partial<WebhookDeps> = {}) {
  const enqueue = vi.fn(async () => undefined);
  return {
    enqueue,
    deps: { getConfig: () => config, enqueue, log: createLogger({}, "error"), ...overrides },
  };
}

function post(body: string, signature: string | null) {
  return new Request(URL_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(signature ? { "X-Hub-Signature-256": signature } : {}),
    },
    body,
  });
}

describe("GET /api/webhooks/whatsapp", () => {
  it("returns the challenge for a valid token", async () => {
    const url = new URL(
      `${URL_BASE}?hub.mode=subscribe&hub.verify_token=${config.verifyToken}&hub.challenge=987654`,
    );
    const res = handleWebhookVerification(url, deps().deps);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("987654");
  });

  it("returns 403 for a wrong token", () => {
    const url = new URL(`${URL_BASE}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`);
    expect(handleWebhookVerification(url, deps().deps).status).toBe(403);
  });

  it("returns 503 when not configured", () => {
    const url = new URL(URL_BASE);
    expect(handleWebhookVerification(url, deps({ getConfig: () => null }).deps).status).toBe(503);
  });
});

describe("POST /api/webhooks/whatsapp", () => {
  const body = JSON.stringify(textMessagePayload());

  it("enqueues a correctly signed event with a content-hash dedupe key", async () => {
    const { deps: d, enqueue } = deps();
    const res = await handleWebhookEvent(post(body, signWebhookBody(body, config.appSecret)), d);
    expect(res.status).toBe(200);
    expect(enqueue).toHaveBeenCalledTimes(1);
    const arg = (enqueue.mock.calls[0] as unknown as [{ dedupeKey: string; payload: unknown }])[0];
    expect(arg.dedupeKey).toMatch(/^wa-webhook:[0-9a-f]{64}$/);
    expect(arg.payload).toMatchObject({ object: "whatsapp_business_account" });
  });

  it("produces the same dedupe key for a retried delivery", async () => {
    const { deps: d, enqueue } = deps();
    const sig = signWebhookBody(body, config.appSecret);
    await handleWebhookEvent(post(body, sig), d);
    await handleWebhookEvent(post(body, sig), d);
    const keys = enqueue.mock.calls.map(
      (c) => (c as unknown as [{ dedupeKey: string }])[0].dedupeKey,
    );
    expect(keys[0]).toBe(keys[1]);
  });

  it("rejects missing or invalid signatures without enqueueing", async () => {
    const { deps: d, enqueue } = deps();
    expect((await handleWebhookEvent(post(body, null), d)).status).toBe(401);
    expect((await handleWebhookEvent(post(body, signWebhookBody(body, "nope")), d)).status).toBe(
      401,
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("acknowledges but ignores signed payloads of an unexpected shape", async () => {
    const { deps: d, enqueue } = deps();
    const other = JSON.stringify({ object: "page", entry: [] });
    const res = await handleWebhookEvent(post(other, signWebhookBody(other, config.appSecret)), d);
    expect(res.status).toBe(200);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies", async () => {
    const { deps: d } = deps();
    const big = "x".repeat(MAX_WEBHOOK_BODY_BYTES + 1);
    expect((await handleWebhookEvent(post(big, "sha256=00"), d)).status).toBe(413);
  });

  it("returns 500 when persistence fails so Meta retries", async () => {
    const { deps: d } = deps({
      enqueue: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    const res = await handleWebhookEvent(post(body, signWebhookBody(body, config.appSecret)), d);
    expect(res.status).toBe(500);
  });
});
