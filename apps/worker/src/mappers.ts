import type { MessageStatus, MessageType } from "@ravi/db";

const TYPE_MAP: Record<string, MessageType> = {
  text: "TEXT",
  image: "IMAGE",
  audio: "AUDIO",
  video: "VIDEO",
  document: "DOCUMENT",
  sticker: "STICKER",
  location: "LOCATION",
  contacts: "CONTACTS",
  interactive: "INTERACTIVE",
  button: "BUTTON",
  reaction: "REACTION",
};

export function toMessageType(waType: string): MessageType {
  return TYPE_MAP[waType] ?? "UNSUPPORTED";
}

const STATUS_MAP: Record<string, MessageStatus> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

export function toMessageStatus(waStatus: string): MessageStatus | null {
  return STATUS_MAP[waStatus] ?? null;
}

const RANK: Record<MessageStatus, number> = {
  RECEIVED: 0,
  PENDING: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 1,
};

/**
 * Webhook statuses can arrive out of order. Only move forward (sent → delivered → read).
 * FAILED applies unless the message was already delivered or read.
 */
export function shouldApplyStatus(current: MessageStatus, next: MessageStatus): boolean {
  if (current === next) return false;
  if (next === "FAILED") return RANK[current] < RANK.DELIVERED;
  if (current === "FAILED") return false;
  return RANK[next] > RANK[current];
}

const OPT_OUT = /^\s*(stop|unsubscribe|opt[\s-]?out)\s*[.!]?\s*$/i;

export function isOptOutRequest(text: string | null): boolean {
  return !!text && OPT_OUT.test(text);
}
