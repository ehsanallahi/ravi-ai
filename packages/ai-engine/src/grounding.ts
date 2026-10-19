/**
 * Deterministic post-generation checks. The model is instructed not to invent facts, but rules
 * are not guarantees. These checks catch the highest-risk failures (prices, quantities, stock
 * levels, phone numbers, links) by requiring every such value in the reply to appear, as a whole
 * number, in the sources or in the customer's own messages. They are deliberately conservative:
 * a false positive hands the conversation to a human, which is safe.
 */

const URDU_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Converts Urdu (Extended Arabic-Indic) and Arabic-Indic digits to ASCII digits. */
export function normalizeDigits(text: string): string {
  return text.replace(/[۰-۹٠-٩]/g, (d) => {
    const i = URDU_DIGITS.indexOf(d);
    return String(i >= 0 ? i : ARABIC_INDIC_DIGITS.indexOf(d));
  });
}

function canonical(raw: string): string {
  const cleaned = raw.replace(/[,\s-]/g, "").replace(/\.$/, "");
  // "2.50" and "2.5" are the same amount; "1500.00" is "1500".
  if (/^\d+\.\d+$/.test(cleaned)) return String(Number(cleaned));
  return cleaned;
}

/**
 * All numeric values (including single digits: "3 days", "5 in stock"), as canonical strings. Commas and hyphens inside a number are
 * treated as separators ("1,500" → "1500", "0300-1234567" → "03001234567"). Spaces split numbers,
 * so "10 20" is two values.
 */
export function extractNumbers(text: string): string[] {
  const matches = normalizeDigits(text).match(/\d(?:[\d,.-]*\d)?/g) ?? [];
  return matches.map(canonical).filter((m) => /\d/.test(m));
}

export function extractUrls(text: string): string[] {
  return (text.match(/\b(?:https?:\/\/|www\.)[^\s)]+/gi) ?? []).map((u) =>
    u.toLowerCase().replace(/[.,!?;:]+$/, ""),
  );
}

export interface GroundingResult {
  ok: boolean;
  unsupportedNumbers: string[];
  unsupportedUrls: string[];
}

/**
 * Every number, including single digits (price, quantity, stock level, days, phone, date), and every URL in the reply
 * must exactly match one in the evidence (sources plus the customer's messages). Otherwise the
 * reply is not used and the conversation goes to a human.
 */
export function checkGrounding(reply: string, evidence: string[]): GroundingResult {
  const evidenceText = evidence.join("\n");
  const allowedNumbers = new Set(extractNumbers(evidenceText));
  const allowedUrls = new Set(extractUrls(evidenceText));

  const unsupportedNumbers = [...new Set(extractNumbers(reply))].filter(
    (n) => !allowedNumbers.has(n),
  );
  const unsupportedUrls = [...new Set(extractUrls(reply))].filter((u) => !allowedUrls.has(u));

  return {
    ok: unsupportedNumbers.length === 0 && unsupportedUrls.length === 0,
    unsupportedNumbers,
    unsupportedUrls,
  };
}
