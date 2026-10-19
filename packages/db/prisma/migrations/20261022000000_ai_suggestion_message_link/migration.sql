-- Links a conversation draft to the inbound message it answers. Additive only: existing rows keep
-- a NULL messageId and are not modified.
ALTER TABLE "AiSuggestion" ADD COLUMN "messageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AiSuggestion_messageId_key" ON "AiSuggestion"("messageId");

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
