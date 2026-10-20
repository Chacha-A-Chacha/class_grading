import "server-only";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { AppError } from "./errors";
import { requireSameOrigin } from "./auth/http";

export function json(data: unknown, status = 200) { return Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } }); }
// PostgreSQL states that mean "try again shortly": serialization failure, deadlock,
// lock timeout and statement timeout. Prisma 7 adapters report them as P2010 with the
// original SQLSTATE under meta.driverAdapterError.cause.
const RETRYABLE_SQLSTATES = new Set(["40001", "40P01", "55P03", "57014"]);
type DatabaseError = { code?: unknown; meta?: { modelName?: unknown; driverAdapterError?: { cause?: { originalCode?: unknown } } } };
function databaseError(error: unknown): DatabaseError | null {
  return error && typeof error === "object" && "code" in error ? error as DatabaseError : null;
}
export function isRetryable(error: unknown): boolean {
  const db = databaseError(error);
  if (!db) return false;
  // P2024: pool wait timed out. P2028: interactive transaction could not start or timed out.
  return db.code === "P2034" || db.code === "P2024" || db.code === "P2028" || RETRYABLE_SQLSTATES.has(String(db.meta?.driverAdapterError?.cause?.originalCode));
}
export function endpoint(action: (request: Request) => Promise<Response>, mutation = true) {
  return async (request: Request) => {
    try {
      if (mutation) requireSameOrigin(request);
      return await action(request);
    } catch (error) {
      // Proxy assigns a server-generated ID to every API request; reuse it for correlation.
      const requestId = request.headers.get("x-request-id") ?? randomUUID();
      if (error instanceof AppError) return json({ code: error.code, message: error.message, requestId }, error.status);
      if (error instanceof ZodError) return json({ code: "INVALID_INPUT", message: error.issues[0]?.message ?? "Invalid input.", requestId }, 422);
      const db = databaseError(error);
      if (db?.code === "P2002") {
        const message = db.meta?.modelName === "User" ? "An account already uses this email or admission number. Refresh the preview." : "This change conflicts with a newer one. Refresh and try again.";
        return json({ code: "CONFLICT", message, requestId }, 409);
      }
      if (isRetryable(error)) {
        const response = json({ code: "BUSY", message: "The server is busy. Your request was not applied; try again.", requestId }, 503);
        response.headers.set("Retry-After", "1");
        return response;
      }
      console.error("Request failed", requestId); // Never log tokens, workbook rows or OTPs.
      return json({ code: "UNAVAILABLE", message: "This operation is unavailable. Check the server configuration and try again.", requestId }, 503);
    }
  };
}
export async function readBody(request: Request, limit: number) {
  if (Number(request.headers.get("content-length") ?? 0) > limit) throw new AppError("TOO_LARGE", "The upload is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("INVALID_INPUT", "A request body is required.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new AppError("TOO_LARGE", "The upload is too large.", 413); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export async function bodyJson(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AppError("INVALID_INPUT", "Expected a JSON request.");
  try { return JSON.parse((await readBody(request, 32_768)).toString("utf8")) as unknown; }
  catch (error) { if (error instanceof AppError) throw error; throw new AppError("INVALID_INPUT", "Invalid JSON."); }
}
