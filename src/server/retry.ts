// PostgreSQL states that mean "try again shortly": serialization failure, deadlock,
// lock timeout and statement timeout. Prisma 7 adapters report them as P2010 with the
// original SQLSTATE under meta.driverAdapterError.cause.
const RETRYABLE_SQLSTATES = new Set(["40001", "40P01", "55P03", "57014"]);
type DatabaseError = { code?: unknown; meta?: { modelName?: unknown; driverAdapterError?: { cause?: { originalCode?: unknown } } } };
export function databaseError(error: unknown): DatabaseError | null {
  return error && typeof error === "object" && "code" in error ? error as DatabaseError : null;
}
export function isRetryable(error: unknown): boolean {
  const db = databaseError(error);
  if (!db) return false;
  // P2024: pool wait timed out. P2028: interactive transaction could not start or timed out.
  return db.code === "P2034" || db.code === "P2024" || db.code === "P2028" || RETRYABLE_SQLSTATES.has(String(db.meta?.driverAdapterError?.cause?.originalCode));
}

/** Retries an idempotent transaction on transient conflicts: at most 3 tries, 20-100 ms jitter. */
export async function withRetry<T>(work: () => Promise<T>, tries = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await work(); }
    catch (error) {
      if (attempt >= tries || !isRetryable(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 80));
    }
  }
}
