import { webhookPayloadSchema } from "@ravi/validation";
import { describe, expect, it, vi } from "vitest";
import { isRetryable, sendTextMessage, WhatsAppApiError } from "./client";
import { statusPayload, textMessagePayload } from "./fixtures";
import { normalizeWebhookPayload } from "./normalize";
import { signWebhookBody, verifyWebhookSignature } from "./signature";
import { verifySubscription } from "./verify";

const SECRET = "test-app-secret";

describe("verifyWebhookSignature", () => {
  const body = JSON.stringify(textMessagePayload({ body: "Prix: 10 € — merci" }));

  it("accepts a valid signature", () => {
    expect(verifyWebhookSignature(body, signWebhookBody(body, SECRET), SECRET)).toBe(true);
  });

  it("rejects a signature made with another secret", () => {
    expect(verifyWebhookSignature(body, signWebhookBody(body, "other"), SECRET)).toBe(false);
  });

  it("rejects a modified body", () => {
    const sig = signWebhookBody(body, SECRET);
    expect(verifyWebhookSignature(body.replace("10", "99"), sig, SECRET)).toBe(false);
  });

  it("rejects missing, malformed or wrong-scheme headers", () => {
    expect(verifyWebhookSignature(body, null, SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, "sha256=xyz", SECRET)).toBe(false);
    const hex = signWebhookBody(body, SECRET).slice("sha256=".length);
    expect(verifyWebhookSignature(body, `sha1=${hex}`, SECRET)).toBe(false);
  });

  it("rejects when no app secret is configured", () => {
    expect(verifyWebhookSignature(body, signWebhookBody(body, ""), "")).toBe(false);
  });
});

describe("verifySubscription", () => {
  const token = "a-long-random-verify-token";

  it("echoes the challenge for a matching token", () => {
    expect(
      verifySubscription({ mode: "subscribe", verifyToken: token, challenge: "1158201444" }, token),
    ).toEqual({ ok: true, challenge: "1158201444" });
  });

  it("rejects a wrong token, wrong mode, or missing challenge", () => {
    expect(
      verifySubscription({ mode: "subscribe", verifyToken: "nope", challenge: "1" }, token).ok,
    ).toBe(false);
    expect(
      verifySubscription({ mode: "unsubscribe", verifyToken: token, challenge: "1" }, token).ok,
    ).toBe(false);
    expect(
      verifySubscription({ mode: "subscribe", verifyToken: token, challenge: null }, token).ok,
    ).toBe(false);
  });

  it("rejects challenges that could inject markup", () => {
    expect(
      verifySubscription({ mode: "subscribe", verifyToken: token, challenge: "<script>" }, token)
        .ok,
    ).toBe(false);
  });
});

describe("normalizeWebhookPayload", () => {
  it("extracts inbound text messages with contact profile", () => {
    const payload = webhookPayloadSchema.parse(textMessagePayload());
    const { events, ignoredChanges } = normalizeWebhookPayload(payload);
    expect(ignoredChanges).toBe(0);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event).toMatchObject({
      kind: "message",
      phoneNumberId: "100000000000001",
      waId: "15550000001",
      profileName: "Test User",
      messageId: "wamid.TEST_INBOUND_1",
      type: "text",
      text: "Hello, what are your opening hours?",
    });
    expect(event?.timestamp.toISOString()).toBe(new Date(1760000000 * 1000).toISOString());
  });

  it.each(["", "abc", "-5", "0", "1e20"])(
    "falls back to the receipt time for a malformed timestamp (%j)",
    (timestamp) => {
      const raw = textMessagePayload();
      raw.entry[0]!.changes[0]!.value.messages![0]!.timestamp = timestamp;
      const before = Date.now();
      const [event] = normalizeWebhookPayload(webhookPayloadSchema.parse(raw)).events;
      expect(Number.isNaN(event!.timestamp.getTime())).toBe(false);
      expect(event!.timestamp.getTime()).toBeGreaterThanOrEqual(before);
    },
  );

  it("extracts status updates including errors", () => {
    const payload = webhookPayloadSchema.parse(statusPayload("failed"));
    const { events } = normalizeWebhookPayload(payload);
    expect(events[0]).toMatchObject({
      kind: "status",
      messageId: "wamid.TEST_OUTBOUND_1",
      status: "failed",
      error: { code: 131047 },
    });
  });

  it("ignores non-message fields and malformed values", () => {
    const payload = webhookPayloadSchema.parse({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "1",
          changes: [
            { field: "account_update", value: {} },
            { field: "messages", value: { messaging_product: "whatsapp" } },
          ],
        },
      ],
    });
    expect(normalizeWebhookPayload(payload)).toEqual({ events: [], ignoredChanges: 2 });
  });
});

describe("sendTextMessage", () => {
  const base = {
    accessToken: "token",
    phoneNumberId: "100000000000001",
    to: "15550000001",
    body: "Hi there",
    graphApiVersion: "v24.0",
  };

  it("posts to the Graph API messages endpoint and returns the message id", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ messages: [{ id: "wamid.SENT_1" }] }, { status: 200 }),
    );
    const result = await sendTextMessage({ ...base, fetchImpl: fetchImpl as typeof fetch });
    expect(result).toEqual({ messageId: "wamid.SENT_1" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v24.0/100000000000001/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token");
    expect(JSON.parse(init.body as string)).toMatchObject({
      messaging_product: "whatsapp",
      to: "15550000001",
      type: "text",
      text: { body: "Hi there" },
    });
  });

  it("classifies API errors as retryable or permanent", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: { message: "Invalid parameter", code: 100 } }, { status: 400 }),
    );
    await expect(
      sendTextMessage({ ...base, fetchImpl: fetchImpl as typeof fetch }),
    ).rejects.toMatchObject({ name: "WhatsAppApiError", retryable: false, code: 100 });

    expect(isRetryable(503, null)).toBe(true);
    expect(isRetryable(429, null)).toBe(true);
    expect(isRetryable(400, 130429)).toBe(true);
    expect(isRetryable(null, null)).toBe(true);
  });

  it("validates inputs before calling the network", async () => {
    const fetchImpl = vi.fn();
    await expect(
      sendTextMessage({ ...base, body: " ", fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/empty/);
    await expect(
      sendTextMessage({
        ...base,
        phoneNumberId: "../evil",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/phone number/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(new WhatsAppApiError("x", 500, null, true).retryable).toBe(true);
  });
});
