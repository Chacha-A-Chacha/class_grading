import type { Metadata } from "next";
import { connection } from "next/server";
import "./globals.css";
import { Inter } from "next/font/google";
import { cn } from "@/lib/utils";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: {
    default: "Code Logic Assessments",
    template: "%s | Code Logic Assessments",
  },
  description: "Programming assessments for code interpretation and conceptual understanding.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Per-request CSP nonces (src/proxy.ts) require dynamic rendering for every page.
  await connection();
  return (
    <html lang="en" className={cn("font-sans antialiased", inter.variable)}>
      <body>{children}</body>
    </html>
  );
}
