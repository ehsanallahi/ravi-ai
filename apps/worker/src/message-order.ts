/**
 * Chronological order of conversation messages. Webhook events can be delivered late, retried or
 * processed concurrently, so insertion time (`createdAt`) is not reliable: WhatsApp's own
 * timestamp (`waTimestamp`, when the customer sent the message) is used when it is plausible, with
 * `createdAt` and then `id` as deterministic tie-breakers. Nothing is stored or reordered.
 */

export interface OrderedMessage {
  id: string;
  waTimestamp: Date | null;
  createdAt: Date;
}

/** A WhatsApp timestamp later than our own receipt time (beyond clock skew) is not trusted. */
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
/** Meta retries undelivered webhooks for days; anything older than this is not trusted. */
export const MAX_DELIVERY_DELAY_MS = 30 * 24 * 60 * 60 * 1000;

/** WhatsApp's send time when present and plausible, otherwise our receipt time. */
export function orderTime(m: OrderedMessage): number {
  const received = m.createdAt.getTime();
  const sent = m.waTimestamp?.getTime();
  if (sent === undefined || !Number.isFinite(sent)) return received;
  if (sent > received + MAX_FUTURE_SKEW_MS || sent < received - MAX_DELIVERY_DELAY_MS) {
    return received;
  }
  return sent;
}

/** Total, deterministic order: send time, then receipt time, then id. */
export function compareMessages(a: OrderedMessage, b: OrderedMessage): number {
  return (
    orderTime(a) - orderTime(b) ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * Database prefilter that is a superset of the messages ordered before (`"before"`) or after
 * (`"after"`) `m`: every such message has a send or receipt time on the same side of `m`'s order
 * time (ties included). Callers then apply `compareMessages` for the exact result.
 */
export function orderTimeFilter(m: OrderedMessage, side: "before" | "after") {
  const t = new Date(orderTime(m));
  const op = side === "before" ? { lte: t } : { gte: t };
  return { OR: [{ waTimestamp: op }, { createdAt: op }] };
}
