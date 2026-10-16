import {
  type InboundMessage,
  messagesChangeValueSchema,
  type WebhookPayload,
} from "@ravi/validation";

export interface NormalizedInboundMessage {
  kind: "message";
  phoneNumberId: string;
  waId: string;
  profileName: string | null;
  messageId: string;
  timestamp: Date;
  type: string;
  text: string | null;
  replyToMessageId: string | null;
  raw: InboundMessage;
}

export interface NormalizedStatus {
  kind: "status";
  phoneNumberId: string;
  messageId: string;
  status: string;
  timestamp: Date;
  recipientId: string | null;
  error: { code: number; title: string | null; message: string | null } | null;
}

export type NormalizedEvent = NormalizedInboundMessage | NormalizedStatus;

export interface NormalizeResult {
  events: NormalizedEvent[];
  /** Changes we do not handle yet (other fields) or that failed validation. */
  ignoredChanges: number;
}

function toDate(unixSeconds: string): Date {
  const n = Number(unixSeconds);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
}

/** Best-effort human-readable text for a message, used for storage and AI context. */
export function extractText(message: InboundMessage): string | null {
  return (
    message.text?.body ??
    message.button?.text ??
    message.interactive?.button_reply?.title ??
    message.interactive?.list_reply?.title ??
    message.image?.caption ??
    message.video?.caption ??
    message.document?.caption ??
    null
  );
}

export function normalizeWebhookPayload(payload: WebhookPayload): NormalizeResult {
  const events: NormalizedEvent[] = [];
  let ignoredChanges = 0;

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages") {
        ignoredChanges++;
        continue;
      }
      const parsed = messagesChangeValueSchema.safeParse(change.value);
      if (!parsed.success) {
        ignoredChanges++;
        continue;
      }
      const value = parsed.data;
      const phoneNumberId = value.metadata.phone_number_id;
      const profiles = new Map(
        (value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null]),
      );

      for (const message of value.messages ?? []) {
        events.push({
          kind: "message",
          phoneNumberId,
          waId: message.from,
          profileName: profiles.get(message.from) ?? null,
          messageId: message.id,
          timestamp: toDate(message.timestamp),
          type: message.type,
          text: extractText(message),
          replyToMessageId: message.context?.id ?? null,
          raw: message,
        });
      }

      for (const status of value.statuses ?? []) {
        const err = status.errors?.[0];
        events.push({
          kind: "status",
          phoneNumberId,
          messageId: status.id,
          status: status.status,
          timestamp: toDate(status.timestamp),
          recipientId: status.recipient_id ?? null,
          error: err
            ? { code: err.code, title: err.title ?? null, message: err.message ?? null }
            : null,
        });
      }
    }
  }

  return { events, ignoredChanges };
}
