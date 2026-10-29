import "dotenv/config";
import { setTimeout as sleep } from "node:timers/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { expireOverdue } from "../src/server/attempts/service";
import { releaseDue } from "../src/server/results/service";

// Separate process from the web app (specification §2). Reads and writes also resolve
// overdue attempts, so worker downtime delays the stored state but never admits late answers.
const SWEEP_MS = 15_000;

function database() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const schema = new URL(connectionString).searchParams.get("schema") ?? "public";
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(schema)) throw new Error("DATABASE_URL schema must be a plain identifier.");
  const max = Number(process.env.WORKER_POOL_SIZE ?? "3");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, max, connectionTimeoutMillis: 5_000, statement_timeout: 60_000, lock_timeout: 2_000, idle_in_transaction_session_timeout: 30_000, application_name: "worker", options: `-c timezone=UTC -c search_path=${schema}` }, { schema }), transactionOptions: { maxWait: 5_000, timeout: 10_000 } });
}

async function main() {
  const db = database();
  const stop = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => stop.abort());
  console.log("Worker started: expiry sweep and automatic result release every 15 seconds.");
  while (!stop.signal.aborted) {
    try {
      const expired = await expireOverdue(db);
      if (expired) console.log(`Expired ${expired} overdue attempt(s).`);
    } catch (error) {
      console.error("Expiry sweep failed; retrying next cycle.", error instanceof Error ? error.message : "");
    }
    try {
      // After expiry, so attempts that just ended are finalised and scored before the barrier check.
      const released = await releaseDue(db);
      if (released) console.log(`Released results for ${released} assessment(s).`);
    } catch (error) {
      console.error("Release check failed; retrying next cycle.", error instanceof Error ? error.message : "");
    }
    await sleep(SWEEP_MS, undefined, { signal: stop.signal }).catch(() => undefined);
  }
  await db.$disconnect();
  console.log("Worker stopped.");
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Worker failed."); process.exitCode = 1; });
