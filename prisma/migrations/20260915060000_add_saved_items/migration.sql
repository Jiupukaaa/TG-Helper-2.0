-- CreateEnum
CREATE TYPE "SavedItemType" AS ENUM ('LINK', 'PHOTO', 'GIF');

-- CreateTable
CREATE TABLE "saved_items" (
    "id" SERIAL NOT NULL,
    "type" "SavedItemType" NOT NULL,
    "url" TEXT,
    "fileId" TEXT,
    "ownerId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_items_ownerId_idx" ON "saved_items"("ownerId");

-- AddForeignKey
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
