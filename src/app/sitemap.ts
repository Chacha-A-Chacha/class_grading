import type { MetadataRoute } from "next";
import { siteUrl } from "@/shared/brand";

// Built per request so the deployed APP_URL is used, not the build machine's.
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: new URL("/", siteUrl()).toString(), changeFrequency: "monthly", priority: 1 }];
}
