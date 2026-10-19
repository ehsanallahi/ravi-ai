-- pgvector for knowledge-base embeddings (Phase 3). Requires the extension to be available on
-- the server (pgvector/pgvector image in CI; `pnpm db:pgvector:setup` locally on Windows).
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "AiOperation" AS ENUM ('CHAT', 'EMBEDDING');

-- CreateEnum
CREATE TYPE "AiFeature" AS ENUM ('PLAYGROUND', 'KNOWLEDGE_INDEXING', 'AUTO_REPLY');

-- CreateEnum
CREATE TYPE "AiSuggestionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AiSuggestionDecision" AS ENUM ('REPLY', 'HANDOFF');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "aiDataConsentAt" TIMESTAMP(3),
ADD COLUMN     "aiDataConsentByUserId" TEXT,
ADD COLUMN     "aiMonthlyBudgetUsd" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "KnowledgeDocument" ADD COLUMN     "embeddingModel" TEXT,
ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "indexedAt" TIMESTAMP(3),
ADD COLUMN     "sourceFilename" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "KnowledgeChunk" ADD COLUMN     "embedding" vector(768),
ADD COLUMN     "embeddingModel" TEXT;

-- CreateTable
CREATE TABLE "AiUsageEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "feature" "AiFeature" NOT NULL,
    "operation" "AiOperation" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "thinkingTokens" INTEGER NOT NULL DEFAULT 0,
    "embeddingDimensions" INTEGER,
    "estimatedCostUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSuggestion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'playground',
    "conversationId" TEXT,
    "question" TEXT NOT NULL,
    "decision" "AiSuggestionDecision" NOT NULL,
    "answer" TEXT,
    "handoffReason" TEXT,
    "withheldDraft" TEXT,
    "language" TEXT,
    "model" TEXT,
    "sources" JSONB NOT NULL,
    "estimatedCostUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "status" "AiSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "rating" INTEGER,
    "reviewNotes" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiUsageEvent_organizationId_createdAt_idx" ON "AiUsageEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiSuggestion_organizationId_createdAt_idx" ON "AiSuggestion"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiUsageEvent" ADD CONSTRAINT "AiUsageEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

