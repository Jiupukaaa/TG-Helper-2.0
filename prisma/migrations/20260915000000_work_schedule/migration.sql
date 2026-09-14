CREATE TABLE "shifts" (
    "id" SERIAL NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "reminders" ADD COLUMN "shiftId" INTEGER;
ALTER TABLE "reminders" ADD COLUMN "offsetMinutes" INTEGER;

CREATE UNIQUE INDEX "shifts_ownerId_startAt_key" ON "shifts"("ownerId", "startAt");
CREATE INDEX "shifts_ownerId_startAt_idx" ON "shifts"("ownerId", "startAt");
CREATE UNIQUE INDEX "reminders_shiftId_offsetMinutes_key" ON "reminders"("shiftId", "offsetMinutes");
CREATE INDEX "reminders_shiftId_idx" ON "reminders"("shiftId");

ALTER TABLE "shifts" ADD CONSTRAINT "shifts_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
