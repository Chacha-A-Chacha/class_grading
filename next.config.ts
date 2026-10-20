import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Revisit caching explicitly when implementing authenticated exam routes.
  cacheComponents: false,
  images: {
    remotePatterns: [],
    dangerouslyAllowSVG: false,
    dangerouslyAllowLocalIP: false,
  },
  async headers() {
    return [
      ...["/api/:path*", "/admin/:path*", "/student/:path*", "/sign-in/:path*"].map((source) => ({
        source,
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      })),
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
