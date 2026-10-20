import "dotenv/config";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { generateSecret, generateURI, verify } from "otplib";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { encrypt, verifier } from "../src/server/auth/crypto";
import { BRAND } from "../src/shared/brand";

async function main() {
  if (!process.stdin.isTTY) throw new Error("Run this command in your own interactive terminal to set up the authenticator.");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Configure DATABASE_URL first.");
  const schema = new URL(connectionString).searchParams.get("schema") ?? "public";
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(schema)) throw new Error("DATABASE_URL schema must be a plain identifier.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 1, options: `-c timezone=UTC -c search_path=${schema}` }, { schema }) });
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const owner = await db.user.findFirst({ where: { isAdmin: true, disabledAt: null }, include: { authenticator: true } });
    if (!owner) throw new Error("Provision the owner with npm run db:seed first.");
    if (owner.authenticator) throw new Error("An authenticator already exists. This bootstrap command cannot replace or reset it.");
    const secret = generateSecret();
    const encryptedTotpSecret = encrypt(secret);
    console.log("Add this secret to your authenticator app. Keep it private:", secret);
    console.log(generateURI({ issuer: BRAND.name, label: owner.email, secret }));
    const code = (await terminal.question("Enter the six-digit code from your authenticator: ")).trim();
    // Verify against the database clock, which sign-in also uses, so a fast or slow
    // laptop clock cannot record a replay step that sign-in cannot accept yet.
    const [{ now }] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const checked = await verify({ secret, token: code, epoch: Math.floor(now.getTime() / 1000), epochTolerance: [30, 0] });
    if (!checked.valid || !("timeStep" in checked)) throw new Error("Code verification failed. Nothing was saved.");
    const recovery = Array.from({ length: 10 }, () => randomBytes(16).toString("hex"));
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${owner.id}::uuid FOR UPDATE`;
      await tx.adminAuthenticator.create({ data: { userId: owner.id, encryptedTotpSecret, confirmedAt: new Date(), lastUsedStep: BigInt(checked.timeStep!), recoveryCodeHashes: recovery.map((value) => verifier("recovery", value)) } });
      await tx.session.updateMany({ where: { userId: owner.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: owner.id, action: "ADMIN_MFA_ENROLLED", targetType: "User", targetId: owner.id, reason: "Owner verified authenticator through the local bootstrap command." } });
    });
    console.log("Save these single-use recovery codes in your password manager. They will not be shown again:\n" + recovery.join("\n"));
  } finally { terminal.close(); await db.$disconnect(); }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Setup failed."); process.exitCode = 1; });
