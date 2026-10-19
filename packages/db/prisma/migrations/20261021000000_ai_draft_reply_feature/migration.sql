-- Additive: usage accounting for WhatsApp reply drafts (stored for review, never sent).
ALTER TYPE "AiFeature" ADD VALUE IF NOT EXISTS 'DRAFT_REPLY';

-- Lists drafts per conversation.
CREATE INDEX IF NOT EXISTS "AiSuggestion_organizationId_conversationId_createdAt_idx" ON "AiSuggestion"("organizationId", "conversationId", "createdAt");
