/**
 * Scans knowledge-base text before it is stored or sent to the AI provider.
 * - "block": content that must never be uploaded (payment card numbers, credentials).
 * - "warn": content a reviewer should check (personal IDs, instruction-like text that could try
 *   to steer the assistant). Warnings are shown in the dashboard; findings never echo the value.
 */
export type FindingKind = "card_number" | "credential" | "national_id" | "prompt_injection";

export interface ContentFinding {
  kind: FindingKind;
  severity: "block" | "warn";
  count: number;
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const CARD_CANDIDATE = /\b(?:\d[ -]?){12,18}\d\b/g;

const CREDENTIAL_PATTERNS: RegExp[] = [
  /\bAIza[0-9A-Za-z_-]{30,}/, // Google API keys
  /\bsk-[A-Za-z0-9_-]{20,}/, // common secret-key prefix
  /\bre_[A-Za-z0-9]{20,}/, // Resend
  /\bEAA[A-Za-z0-9]{40,}/, // Meta access tokens
  /\bghp_[A-Za-z0-9]{30,}/, // GitHub tokens
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:password|passwd|pwd|api[_-]?key|secret)\s*[:=]\s*\S{6,}/i,
];

/** Pakistani CNIC format (personal identity number). */
const NATIONAL_ID = /\b\d{5}-\d{7}-\d\b/g;

const INJECTION_PATTERNS: RegExp[] = [
  /\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier|your)\s+(?:instructions|rules|prompts?)/i,
  /\byou\s+are\s+now\b/i,
  /\b(?:reveal|print|show)\s+(?:your|the)\s+(?:system\s+)?(?:prompt|instructions)/i,
  /\bsystem\s+prompt\b/i,
  /\b(?:pichli|pehli)\s+(?:hidayat|instructions)\s+(?:ignore|bhool)/i, // Roman Urdu
  /(?:پچھلی|سابقہ)\s+ہدایات/, // Urdu: "previous instructions"
];

export function scanKnowledgeContent(text: string): ContentFinding[] {
  const findings: ContentFinding[] = [];

  const cards = (text.match(CARD_CANDIDATE) ?? [])
    .map((m) => m.replace(/[ -]/g, ""))
    .filter((d) => d.length >= 13 && d.length <= 19 && luhnValid(d));
  if (cards.length) findings.push({ kind: "card_number", severity: "block", count: cards.length });

  const credentials = CREDENTIAL_PATTERNS.filter((p) => p.test(text)).length;
  if (credentials) findings.push({ kind: "credential", severity: "block", count: credentials });

  const ids = text.match(NATIONAL_ID)?.length ?? 0;
  if (ids) findings.push({ kind: "national_id", severity: "warn", count: ids });

  const injections = INJECTION_PATTERNS.filter((p) => p.test(text)).length;
  if (injections) findings.push({ kind: "prompt_injection", severity: "warn", count: injections });

  return findings;
}

export const FINDING_TEXT: Record<FindingKind, string> = {
  card_number: "payment card numbers",
  credential: "passwords, API keys or other credentials",
  national_id: "national identity (CNIC) numbers",
  prompt_injection: "instruction-like text that could try to change the assistant's behaviour",
};
