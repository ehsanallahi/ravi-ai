import { buildSupportSystemPrompt, HANDOFF_TOKEN, toChatMessages } from "./prompt";
import type { Retriever } from "./rag/retriever";
import type { ChatMessage, LLMProvider } from "./types";

export type HandoffReason =
  | "no_knowledge"
  | "human_requested"
  | "model_handoff"
  | "refused"
  | "empty_reply"
  | "no_customer_message";

export type ReplyDecision =
  | { kind: "reply"; text: string; model: string; sourceChunkIds: string[] }
  | { kind: "handoff"; reason: HandoffReason };

const HUMAN_REQUEST =
  /\b(human|real person|agent|representative|someone|staff|manager|call me|speak to|talk to)\b/i;

export function asksForHuman(text: string): boolean {
  return HUMAN_REQUEST.test(text);
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
 * Decides whether and what to reply. It is conservative: with no relevant knowledge, the LLM is
 * not called and the conversation is handed to a human.
 */
export async function generateGroundedReply(input: GenerateReplyInput): Promise<ReplyDecision> {
  const messages = toChatMessages(input.history);
  const lastUser = messages[messages.length - 1];
  if (!lastUser) return { kind: "handoff", reason: "no_customer_message" };
  if (asksForHuman(lastUser.content)) return { kind: "handoff", reason: "human_requested" };

  const chunks = await input.retriever.retrieve({
    organizationId: input.organizationId,
    query: lastUser.content,
    limit: input.retrievalLimit ?? 5,
  });
  if (chunks.length === 0) return { kind: "handoff", reason: "no_knowledge" };

  const result = await input.provider.generate({
    system: buildSupportSystemPrompt({ businessName: input.businessName, chunks }),
    messages,
  });

  if (result.refused) return { kind: "handoff", reason: "refused" };
  const text = result.text.trim();
  if (!text) return { kind: "handoff", reason: "empty_reply" };
  if (text.includes(HANDOFF_TOKEN)) return { kind: "handoff", reason: "model_handoff" };

  const max = input.maxReplyChars ?? 4000;
  return {
    kind: "reply",
    text: text.length > max ? `${text.slice(0, max - 1)}…` : text,
    model: result.model,
    sourceChunkIds: chunks.map((c) => c.id),
  };
}
