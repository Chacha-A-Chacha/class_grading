-- CreateEnum
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('SENT', 'FAILED');

-- CreateTable
CREATE TABLE "EmailDelivery" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "challengeId" UUID NOT NULL,
    "purpose" "ChallengePurpose" NOT NULL,
    "status" "EmailDeliveryStatus" NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "smtpCode" INTEGER,
    "errorCode" VARCHAR(40),
    "stage" VARCHAR(40),
    "detail" VARCHAR(300),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailDelivery_createdAt_idx" ON "EmailDelivery"("createdAt");

-- CreateIndex
CREATE INDEX "EmailDelivery_userId_createdAt_idx" ON "EmailDelivery"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Delivery rows record outcomes only: timing is non-negative and codes are real SMTP replies.
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_valid_result" CHECK (
  "durationMs" >= 0 AND ("smtpCode" IS NULL OR "smtpCode" BETWEEN 200 AND 599));
