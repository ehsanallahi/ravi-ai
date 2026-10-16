export function roleLabel(role: string): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

export function statusLabel(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

export function contactName(contact: {
  displayName?: string | null;
  profileName?: string | null;
  waId: string;
}): string {
  return contact.displayName || contact.profileName || `+${contact.waId}`;
}

const dateTime = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });
const date = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

export function formatDateTime(value: Date | string | null | undefined): string {
  return value ? dateTime.format(new Date(value)) : "—";
}

export function formatDate(value: Date | string | null | undefined): string {
  return value ? date.format(new Date(value)) : "—";
}

export function formatMoney(
  value: { toString(): string } | null | undefined,
  currency: string | null,
) {
  if (value === null || value === undefined) return "—";
  const n = Number(value.toString());
  if (!currency) return n.toLocaleString("en");
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(n);
  } catch {
    return `${n.toLocaleString("en")} ${currency}`;
  }
}
