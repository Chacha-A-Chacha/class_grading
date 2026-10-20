import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const displayName = process.env.ADMIN_NAME?.trim();
  if (!connectionString || !email || !displayName) {
    throw new Error("Set DATABASE_URL, ADMIN_EMAIL and ADMIN_NAME before seeding.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || displayName.length > 120) {
    throw new Error("Supply a valid admin email and a name of at most 120 characters.");
  }

  const schema = new URL(connectionString).searchParams.get("schema") ?? "public";
  const database = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 1, options: "-c timezone=UTC" }, { schema }) });
  try {
    await database.$transaction(async (tx) => {
      // Serialize concurrent bootstrap commands without locking unrelated work.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(741852963)`;
      const admin = await tx.user.findFirst({ where: { isAdmin: true } });
      if (admin) {
        if (admin.email !== email) throw new Error("An admin already exists. Admin replacement requires an explicit audited operation.");
        return;
      }
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) throw new Error("That email belongs to a student. Bootstrap does not promote existing accounts.");
      const created = await tx.user.create({ data: { email, displayName, isAdmin: true } });
      await tx.auditLog.create({ data: {
        actorId: created.id,
        action: "ADMIN_BOOTSTRAPPED",
        targetType: "User",
        targetId: created.id,
        reason: "Initial owner provisioned by the local bootstrap command.",
      } });
    });
    console.log("Admin account provisioned. Sign in with an email code to verify the address.");
  } finally {
    await database.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Admin bootstrap failed.");
  process.exitCode = 1;
});
