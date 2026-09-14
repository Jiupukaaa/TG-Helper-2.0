ALTER TABLE "shifts" ADD COLUMN "cycleGroupId" TEXT;

CREATE INDEX "shifts_ownerId_cycleGroupId_idx" ON "shifts"("ownerId", "cycleGroupId");
