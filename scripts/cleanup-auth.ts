import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

// Run on a schedule (cron/systemd timer, later the worker): every 15 minutes is enough.
// All cut-offs use the database clock.
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const schema = new URL(connectionString).searchParams.get("schema") ?? "public";
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(schema)) throw new Error("DATABASE_URL schema must be a plain identifier.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 1, options: `-c timezone=UTC -c search_path=${schema}`, application_name: "cleanup" }, { schema }) });
  try {
    // Expired previews hold names and emails; keep only committed receipts.
    const previews = await db.$executeRaw`UPDATE "StudentImport" SET "rows" = NULL WHERE "rows" IS NOT NULL AND "expiresAt" <= clock_timestamp()`;
    const buckets = await db.$executeRaw`DELETE FROM "AuthRateLimitBucket" WHERE "expiresAt" < clock_timestamp()`;
    // Login codes are useless two minutes after issue; a day of history aids support questions.
    const challenges = await db.$executeRaw`DELETE FROM "EmailLoginChallenge" WHERE "purpose" = 'LOGIN' AND "expiresAt" < clock_timestamp() - interval '1 day'`;
    // The delivery log answers "did my code send?" support questions; a month is enough.
    const deliveries = await db.$executeRaw`DELETE FROM "EmailDelivery" WHERE "createdAt" < clock_timestamp() - interval '30 days'`;
    // Page-activity records: 90 days after results release (the rules notice promises this),
    // held while an open review case still needs them (specification §11).
    const awayEvents = await db.$executeRaw`
      DELETE FROM "AttemptEvent" e USING "Attempt" a, "Assessment" s
      WHERE e."attemptId" = a.id AND s.id = a."assessmentId" AND e.kind IN ('AWAY', 'SMALL_WINDOW')
        AND s."releasedAt" < clock_timestamp() - interval '90 days'
        AND NOT EXISTS (SELECT 1 FROM "ReviewCase" r WHERE r."attemptId" = a.id AND r.status = 'OPEN')`;
    // Keep sessions linked to attempt history or takeover challenges as review evidence.
    const sessions = await db.$executeRaw`
      DELETE FROM "Session" s
      WHERE COALESCE(s."revokedAt", s."expiresAt") < clock_timestamp() - interval '30 days'
        AND NOT EXISTS (SELECT 1 FROM "AttemptSession" a WHERE a."userSessionId" = s.id)
        AND NOT EXISTS (SELECT 1 FROM "EmailLoginChallenge" c WHERE c."requestingSessionId" = s.id)`;
    console.log(`Cleaned ${previews} import previews, ${buckets} rate-limit buckets, ${challenges} login codes, ${deliveries} email log rows, ${awayEvents} page-activity records and ${sessions} sessions.`);
  } finally { await db.$disconnect(); }
}
main().catch(() => { console.error("Cleanup failed. Check database configuration."); process.exitCode = 1; });
