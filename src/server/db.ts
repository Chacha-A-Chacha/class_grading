import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalDatabase = globalThis as unknown as { database?: PrismaClient };

/** One bounded pool per process, including across development hot reloads. */
export function getDatabase(): PrismaClient {
  if (globalDatabase.database) return globalDatabase.database;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for database access.");

  const max = Number(process.env.DATABASE_POOL_SIZE ?? "5");
  if (!Number.isInteger(max) || max < 1 || max > 20) {
    throw new Error("DATABASE_POOL_SIZE must be an integer between 1 and 20.");
  }

  const schema = new URL(connectionString).searchParams.get("schema") ?? "public";
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(schema)) throw new Error("DATABASE_URL schema must be a plain identifier.");
  const adapter = new PrismaPg({
    connectionString,
    max,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
    // Fail fast instead of queueing behind a held row lock or an abandoned transaction;
    // callers surface these as retryable 503s (see src/server/http.ts).
    lock_timeout: 2_000,
    idle_in_transaction_session_timeout: 10_000,
    application_name: process.env.DB_APP_NAME ?? "web",
    // Raw SQL ($queryRaw) resolves unqualified tables through search_path, not the
    // adapter's schema option, so both must name the same schema.
    options: `-c timezone=UTC -c search_path=${schema}`,
  }, { schema });

  globalDatabase.database = new PrismaClient({
    adapter,
    // Query logging can expose exam content and auth material; leave it off.
    transactionOptions: { maxWait: 5_000, timeout: 5_000 },
  });
  return globalDatabase.database;
}
