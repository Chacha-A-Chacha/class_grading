import type { MetadataRoute } from "next";
import { siteUrl } from "@/shared/brand";

// Built per request so the deployed APP_URL is used, not the build machine's.
export const dynamic = "force-dynamic";

/** Only the public landing page may be crawled; private areas also send X-Robots-Tag: noindex. */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/student", "/sign-in", "/api/"] },
    sitemap: new URL("/sitemap.xml", base).toString(),
    host: base.origin,
  };
}
