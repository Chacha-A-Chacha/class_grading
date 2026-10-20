const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Development only: localhost, 127.0.0.1 and [::1] on the same port are the same machine,
 * but browsers report them as different origins. Production accepts only APP_URL.
 */
export function loopbackAlias(received: string | null, expected: string, production = process.env.NODE_ENV === "production") {
  if (production || !received) return false;
  try {
    const a = new URL(received), b = new URL(expected);
    return a.protocol === b.protocol && a.port === b.port && LOOPBACK.has(a.hostname) && LOOPBACK.has(b.hostname);
  } catch { return false; }
}
