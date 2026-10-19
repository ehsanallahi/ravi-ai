-- CreateTable
CREATE TABLE "AiBudgetReservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "amountUsd" DECIMAL(12,6) NOT NULL,
    "feature" "AiFeature" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "AiBudgetReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiBudgetReservation_organizationId_releasedAt_createdAt_idx" ON "AiBudgetReservation"("organizationId", "releasedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "AiBudgetReservation" ADD CONSTRAINT "AiBudgetReservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

