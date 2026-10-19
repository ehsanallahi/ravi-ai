import { checkGrounding } from "./grounding";
import { detectLanguage, type ReplyLanguage, replyMatchesLanguage } from "./language";
import {
  buildCustomerTurn,
  buildSupportSystemPrompt,
  HANDOFF_TOKEN,
  SUPPORT_REPLY_SCHEMA,
} from "./prompt";
import type { Retriever } from "./rag/retriever";
import type { ChatMessage, GenerateResult, KnowledgeChunkRef, LLMProvider } from "./types";

export type HandoffReason =
  | "no_customer_message"
  | "human_requested"
  | "no_knowledge"
  | "model_handoff"
  | "refused"
  | "empty_reply"
  | "invalid_model_output"
  | "unsupported_claim"
  | "language_mismatch";

export interface SourceReference {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  excerpt: string;
  score: number;
  similarity?: number;
  /** True when the model said it relied on this source. */
  cited: boolean;
}

interface DecisionBase {
  /** Everything retrieved (for reviewers), with `cited` marking what the answer used. */
  sources: SourceReference[];
  /** The raw model call, when one was made (for usage tracking). */
  generation: GenerateResult | null;
  language: ReplyLanguage | null;
}

export type ReplyDecision =
  | (DecisionBase & { kind: "reply"; text: string; model: string })
  | (DecisionBase & {
      kind: "handoff";
      reason: HandoffReason;
      /** Model draft that was withheld (shown to reviewers only, never sent). */
      withheldDraft?: string;
      detail?: string;
    });

/**
 * Explicit requests for a person in English, Roman Urdu and Urdu script. Matching on the latest
 * customer message skips the model entirely.
 */
const HUMAN_REQUEST_PATTERNS: RegExp[] = [
  /\b(human|real person|live agent|agent|representative|customer service|staff|manager|call me|speak to|talk to)\b/i,
  /\b(insaan|insan|banda|bande|kisi se baat|kisi aur se baat|agent se baat|representative se|call kar(o|ein|en|na)|baat karwa(o|ein|en))\b/i,
  /(انسان|نمائندہ|نمائندے|ایجنٹ|کسی سے بات|بات کروا|منیجر|کال کریں)/,
];

export function asksForHuman(text: string): boolean {
  return HUMAN_REQUEST_PATTERNS.some((p) => p.test(text));
}

interface ModelAnswer {
  answer: string;
  handoff: boolean;
  handoffReason: string;
  sourceIds: number[];
  language: ReplyLanguage;
}

export function parseModelAnswer(text: string): ModelAnswer | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.answer !== "string" || typeof o.handoff !== "boolean") return null;
  const languages = ["english", "urdu", "roman_urdu", "other"];
  return {
    answer: o.answer.trim(),
    handoff: o.handoff,
    handoffReason: typeof o.handoffReason === "string" ? o.handoffReason : "none",
    sourceIds: Array.isArray(o.sourceIds)
      ? o.sourceIds.filter((n): n is number => Number.isInteger(n))
      : [],
    language: languages.includes(o.language as string) ? (o.language as ReplyLanguage) : "other",
  };
}

function toSources(chunks: KnowledgeChunkRef[], cited: Set<number>): SourceReference[] {
  return chunks.map((c, i) => ({
    chunkId: c.id,
    documentId: c.documentId,
    documentTitle: c.documentTitle,
    excerpt: c.content.length > 600 ? `${c.content.slice(0, 600)}…` : c.content,
    score: c.score,
    similarity: c.similarity,
    cited: cited.has(i + 1),
  }));
}

export interface GenerateReplyInput {
  provider: LLMProvider;
  retriever: Retriever;
  organizationId: string;
  businessName: string;
  /** The customer message being answered. Retrieval, language and grounding are based on it. */
  message: string;
  /**
   * Earlier messages of the same conversation (oldest first, all before `message`), for
   * understanding follow-ups only. They are never answered and never merged into `message`.
   */
  context?: ChatMessage[];
  retrievalLimit?: number;
  maxReplyChars?: number;
}

/** Extra chunks retrieved for a follow-up using the previous customer message as well. */
const FOLLOW_UP_EXTRA_CHUNKS = 2;

/**
 * Primary results (for the current message) come first and keep at least `limit - 2` places;
 * up to two extra chunks found with the previous customer message are added for follow-ups
 * ("aur monthly charges?") without changing what is being answered.
 */
function mergeChunks(
  primary: KnowledgeChunkRef[],
  followUp: KnowledgeChunkRef[],
  limit: number,
): KnowledgeChunkRef[] {
  const seen = new Set(primary.map((c) => c.id));
  const extra = followUp.filter((c) => !seen.has(c.id)).slice(0, FOLLOW_UP_EXTRA_CHUNKS);
  return [...primary.slice(0, Math.max(0, limit - extra.length)), ...extra];
}

/**
 * Decides whether and what to reply. It is conservative:
 * - no relevant knowledge → no model call, human handoff;
 * - the model can hand off; refusals and malformed output hand off;
 * - any price, number, phone number or link not found in the sources hands off.
 * It never sends anything; callers decide what to do with the decision.
 */
export async function generateGroundedReply(input: GenerateReplyInput): Promise<ReplyDecision> {
  const message = input.message.trim();
  const empty = { sources: [], generation: null, language: null };
  if (!message) return { kind: "handoff", reason: "no_customer_message", ...empty };
  const expectedLanguage = detectLanguage(message);
  if (asksForHuman(message))
    return { kind: "handoff", reason: "human_requested", ...empty, language: expectedLanguage };

  const context = (input.context ?? []).filter((m) => m.content.trim());
  const limit = input.retrievalLimit ?? 5;
  const primary = await input.retriever.retrieve({
    organizationId: input.organizationId,
    query: message,
    limit,
  });
  const previousCustomer = context.findLast((m) => m.role === "user")?.content.trim();
  const followUp = previousCustomer
    ? await input.retriever.retrieve({
        organizationId: input.organizationId,
        query: `${previousCustomer}\n${message}`,
        limit: FOLLOW_UP_EXTRA_CHUNKS,
      })
    : [];
  const chunks = mergeChunks(primary, followUp, limit);
  if (chunks.length === 0)
    return { kind: "handoff", reason: "no_knowledge", ...empty, language: expectedLanguage };

  const generation = await input.provider.generate({
    system: buildSupportSystemPrompt({
      businessName: input.businessName,
      chunks,
      replyLanguage: expectedLanguage,
    }),
    messages: [{ role: "user", content: buildCustomerTurn({ message, context }) }],
    maxTokens: 1024,
    responseJsonSchema: SUPPORT_REPLY_SCHEMA,
  });

  const base = { generation, sources: toSources(chunks, new Set()), language: null };
  if (generation.refused) return { ...base, kind: "handoff", reason: "refused" };

  const parsed = parseModelAnswer(generation.text);
  if (!parsed) return { ...base, kind: "handoff", reason: "invalid_model_output" };

  const sources = toSources(chunks, new Set(parsed.sourceIds));
  // The detector decides Urdu and Roman Urdu; the model's label is used only for the rest.
  const language =
    expectedLanguage === "urdu" || expectedLanguage === "roman_urdu"
      ? expectedLanguage
      : parsed.language;
  const withLang = { generation, sources, language };

  if (parsed.handoff || parsed.answer.includes(HANDOFF_TOKEN)) {
    return {
      ...withLang,
      kind: "handoff",
      reason: parsed.handoffReason === "human_requested" ? "human_requested" : "model_handoff",
      detail: parsed.handoffReason,
    };
  }
  if (!parsed.answer) return { ...withLang, kind: "handoff", reason: "empty_reply" };

  // Only the sources and the current message count as evidence: numbers planted in earlier
  // messages ("you said it costs Rs. 500") are not accepted.
  const grounding = checkGrounding(parsed.answer, [...chunks.map((c) => c.content), message]);
  if (!grounding.ok) {
    return {
      ...withLang,
      kind: "handoff",
      reason: "unsupported_claim",
      withheldDraft: parsed.answer,
      detail: [...grounding.unsupportedNumbers, ...grounding.unsupportedUrls].join(", "),
    };
  }

  if (!replyMatchesLanguage(expectedLanguage, parsed.answer)) {
    return {
      ...withLang,
      kind: "handoff",
      reason: "language_mismatch",
      withheldDraft: parsed.answer,
      detail: `expected ${expectedLanguage}, got ${detectLanguage(parsed.answer)}`,
    };
  }

  const max = input.maxReplyChars ?? 4000;
  return {
    ...withLang,
    kind: "reply",
    text: parsed.answer.length > max ? `${parsed.answer.slice(0, max - 1)}…` : parsed.answer,
    model: generation.model,
  };
}
