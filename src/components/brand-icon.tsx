import { BRAND } from "@/shared/brand";

/** The `{ }` mark as plain SVG, for generated icons and preview images (no CSS available there). */
export function BrandIcon({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <rect width="32" height="32" rx="7" fill={BRAND.colors.primary} />
    <g transform="translate(4 4)" fill="none" stroke={BRAND.colors.primaryForeground} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1" />
      <path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1" />
    </g>
  </svg>;
}
