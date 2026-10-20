-- CreateTable
CREATE TABLE "StudentImport" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actorId" UUID NOT NULL,
    "rows" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "committedAt" TIMESTAMPTZ(3),
    "selection" INTEGER[],
    "result" JSONB,

    CONSTRAINT "StudentImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudentImport_expiresAt_idx" ON "StudentImport"("expiresAt");

-- CreateIndex
CREATE INDEX "StudentImport_actorId_createdAt_idx" ON "StudentImport"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "StudentImport" ADD CONSTRAINT "StudentImport_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
