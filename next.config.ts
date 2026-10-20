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
        // Belt and braces with robots.txt: private areas are never indexed, even if linked.
        headers: [{ key: "Cache-Control", value: "private, no-store" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }],
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
