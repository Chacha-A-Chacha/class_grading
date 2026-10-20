import "server-only";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { AppError } from "./errors";
import { requireSameOrigin } from "./auth/http";
import { databaseError, isRetryable } from "./retry";

export function json(data: unknown, status = 200) { return Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } }); }
export function endpoint<Context = unknown>(action: (request: Request, context: Context) => Promise<Response>, mutation = true) {
  return async (request: Request, context: Context) => {
    try {
      if (mutation) requireSameOrigin(request);
      return await action(request, context);
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
      // Production logs only the error type and code: messages can contain tokens, workbook
      // rows, OTPs or question content. Development logs the full error for diagnosis.
      const failure = databaseError(error);
      if (process.env.NODE_ENV === "production") console.error("Request failed", requestId, error instanceof Error ? error.name : typeof error, failure?.code ?? "");
      else console.error("Request failed", requestId, error);
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
export async function bodyJson(request: Request, limit = 32_768) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AppError("INVALID_INPUT", "Expected a JSON request.");
  try { return JSON.parse((await readBody(request, limit)).toString("utf8")) as unknown; }
  catch (error) { if (error instanceof AppError) throw error; throw new AppError("INVALID_INPUT", "Invalid JSON."); }
}
