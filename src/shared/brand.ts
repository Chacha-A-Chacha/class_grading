/** Product identity in one place. The product is independent of any one school or programme. */
export const BRAND = {
  name: "Tracebench",
  tagline: "Timed code-reading assessments, run fairly.",
  description: "Tracebench runs timed assessments that test how well you can read code and reason about what it does.",
  /** Link previews (Open Graph, X, WhatsApp): keep the description under about 160 characters. */
  shareTitle: "Tracebench: timed code-reading assessments, run fairly",
  shareDescription: "Sign in to your class's code assessments. No password needed, answers saved as you go, and the same clock for everyone.",
  locale: "en_KE",
  /** Hex equivalents of the theme tokens in globals.css, for places that cannot use CSS variables. */
  colors: { primary: "#ca3500", primaryForeground: "#fff7ed", foreground: "#0c0c09", muted: "#f4f4f0", mutedForeground: "#7c7c67", border: "#e8e8e3" },
} as const;

/** Public base URL for canonical links and absolute preview-image URLs. */
export function siteUrl() {
  return new URL(process.env.APP_URL || "http://127.0.0.1:3000");
}
