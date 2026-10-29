import { readdir } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "../generated/prisma/client";

/** Migration folders shipped with this build, read once per process. */
let expected: Promise<string[]> | null = null;
const shipped = () => (expected ??= readdir(path.join(process.cwd(), "prisma", "migrations"), { withFileTypes: true })
  .then((entries) => entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()));

/**
 * Readiness (specification §11): the database answers and every shipped migration is applied,
 * none half-applied. Reports only a coarse reason, never connection details or names.
 */
export async function readiness(db: PrismaClient): Promise<{ ready: true } | { ready: false; reason: "database" | "migrations" }> {
  let rows: { migration_name: string; finished: boolean; rolled_back: boolean }[];
  try {
    rows = await Promise.race([
      db.$queryRaw<typeof rows>`SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM "_prisma_migrations"`,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
    ]);
  } catch { return { ready: false, reason: "database" }; }
  try {
    const applied = new Set(rows.filter((r) => r.finished && !r.rolled_back).map((r) => r.migration_name));
    const pending = rows.some((r) => !r.finished && !r.rolled_back);
    if (pending || (await shipped()).some((name) => !applied.has(name))) return { ready: false, reason: "migrations" };
  } catch { return { ready: false, reason: "migrations" }; }
  return { ready: true };
}
