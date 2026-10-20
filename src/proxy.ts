import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

// Request-boundary concerns only: correlation IDs and per-request CSP nonces.
// Authorization belongs in each server entry point.
export function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  const isApi = request.nextUrl.pathname.startsWith("/api/");
  const requestId = randomUUID();
  // Replace client-supplied values rather than trusting them in diagnostics.
  requestHeaders.set("x-request-id", requestId);

  const https = process.env.APP_URL?.startsWith("https://") ?? false;
  let csp: string | null = null;
  if (!isApi) {
    // Next.js reads the request CSP header during dynamic rendering and applies this
    // nonce to its own scripts. The root layout opts every page into dynamic rendering.
    const nonce = Buffer.from(randomUUID()).toString("base64");
    csp = [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
      // Components set inline style attributes, which nonces cannot cover.
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data:",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      ...(https ? ["upgrade-insecure-requests"] : []),
    ].join("; ");
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  if (csp) response.headers.set("Content-Security-Policy", csp);
  if (https) response.headers.set("Strict-Transport-Security", "max-age=31536000");
  return response;
}

export const config = {
  matcher: [{
    source: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:csv|svg|png|ico|txt)$).*)",
    missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }],
  }],
};
