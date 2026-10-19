import { checkGrounding } from "./grounding";
import {
  buildSupportSystemPrompt,
  HANDOFF_TOKEN,
  SUPPORT_REPLY_SCHEMA,
  toChatMessages,
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
  | "unsupported_claim";

export type ReplyLanguage = "english" | "urdu" | "roman_urdu" | "other";

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
  history: ChatMessage[];
  retrievalLimit?: number;
  maxReplyChars?: number;
}

/**
 * Decides whether and what to reply. It is conservative:
 * - no relevant knowledge → no model call, human handoff;
 * - the model can hand off; refusals and malformed output hand off;
 * - any price, number, phone number or link not found in the sources hands off.
 * It never sends anything; callers decide what to do with the decision.
 */
export async function generateGroundedReply(input: GenerateReplyInput): Promise<ReplyDecision> {
  const messages = toChatMessages(input.history);
  const lastUser = messages[messages.length - 1];
  const empty = { sources: [], generation: null, language: null };
  if (!lastUser) return { kind: "handoff", reason: "no_customer_message", ...empty };
  if (asksForHuman(lastUser.content))
    return { kind: "handoff", reason: "human_requested", ...empty };

  const chunks = await input.retriever.retrieve({
    organizationId: input.organizationId,
    query: lastUser.content,
    limit: input.retrievalLimit ?? 5,
  });
  if (chunks.length === 0) return { kind: "handoff", reason: "no_knowledge", ...empty };

  const generation = await input.provider.generate({
    system: buildSupportSystemPrompt({ businessName: input.businessName, chunks }),
    messages,
    maxTokens: 1024,
    responseJsonSchema: SUPPORT_REPLY_SCHEMA,
  });

  const base = { generation, sources: toSources(chunks, new Set()), language: null };
  if (generation.refused) return { ...base, kind: "handoff", reason: "refused" };

  const parsed = parseModelAnswer(generation.text);
  if (!parsed) return { ...base, kind: "handoff", reason: "invalid_model_output" };

  const sources = toSources(chunks, new Set(parsed.sourceIds));
  const withLang = { generation, sources, language: parsed.language };

  if (parsed.handoff || parsed.answer.includes(HANDOFF_TOKEN)) {
    return {
      ...withLang,
      kind: "handoff",
      reason: parsed.handoffReason === "human_requested" ? "human_requested" : "model_handoff",
      detail: parsed.handoffReason,
    };
  }
  if (!parsed.answer) return { ...withLang, kind: "handoff", reason: "empty_reply" };

  const customerText = messages.filter((m) => m.role === "user").map((m) => m.content);
  const grounding = checkGrounding(parsed.answer, [
    ...chunks.map((c) => c.content),
    ...customerText,
  ]);
  if (!grounding.ok) {
    return {
      ...withLang,
      kind: "handoff",
      reason: "unsupported_claim",
      withheldDraft: parsed.answer,
      detail: [...grounding.unsupportedNumbers, ...grounding.unsupportedUrls].join(", "),
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
