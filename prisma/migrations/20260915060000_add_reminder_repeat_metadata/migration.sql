ALTER TABLE "reminders" ADD COLUMN "repeatGroupId" TEXT;
ALTER TABLE "reminders" ADD COLUMN "repeatRule" TEXT;
CREATE INDEX "reminders_ownerId_repeatGroupId_idx" ON "reminders"("ownerId", "repeatGroupId");
