import { ImageResponse } from "next/og";
import { BRAND } from "@/shared/brand";
import { BrandIcon } from "@/components/brand-icon";

// Link-preview card (Facebook, LinkedIn, WhatsApp, X). 1200x630 is the 1.91:1 size every
// network accepts; generated once at build time, so it is a small static PNG.
export const alt = `${BRAND.name}: ${BRAND.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const c = BRAND.colors;
const code = ["const marks = [72, 45, 90];", "const passed = marks.filter((m) => m >= 60);", "console.log(passed.length);"];

export default function OpengraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#ffffff", color: c.foreground, borderTop: `16px solid ${c.primary}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <BrandIcon size={84} />
        <div style={{ fontSize: 60, fontWeight: 700, color: c.primary }}>{BRAND.name}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ fontSize: 58, fontWeight: 700, lineHeight: 1.1, maxWidth: 980 }}>{BRAND.tagline}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "22px 28px", borderRadius: 16, background: c.muted, border: `2px solid ${c.border}`, fontFamily: "monospace", fontSize: 26, color: c.foreground }}>
        <div style={{ display: "flex", marginBottom: 8, fontFamily: "sans-serif", fontWeight: 600, color: c.mutedForeground }}>What does this log?</div>
        {code.map((line) => <div key={line} style={{ display: "flex" }}>{line}</div>)}
      </div>
    </div>,
    size,
  );
}
