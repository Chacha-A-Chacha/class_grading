import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import "./globals.css";
import { Inter } from "next/font/google";
import { cn } from "@/lib/utils";
import { BRAND, siteUrl } from "@/shared/brand";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: {
    default: BRAND.name,
    template: `%s | ${BRAND.name}`,
  },
  description: BRAND.description,
  applicationName: BRAND.name,
  // Private by default; the public landing page opts in to indexing.
  robots: { index: false, follow: false },
  openGraph: { type: "website", siteName: BRAND.name, locale: BRAND.locale, url: "/", title: BRAND.shareTitle, description: BRAND.shareDescription },
  twitter: { card: "summary_large_image", title: BRAND.shareTitle, description: BRAND.shareDescription },
};
export const viewport: Viewport = { themeColor: BRAND.colors.primary };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Per-request CSP nonces (src/proxy.ts) require dynamic rendering for every page.
  await connection();
  return (
    <html lang="en" className={cn("font-sans antialiased", inter.variable)}>
      <body>{children}</body>
    </html>
  );
}
