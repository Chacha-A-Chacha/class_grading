import Link from "next/link";
import { Braces } from "lucide-react";
import { BRAND } from "@/shared/brand";
import { cn } from "@/lib/utils";

/** Wordmark used in every header. */
export function BrandMark({ href = "/", suffix, className }: { href?: string; suffix?: string; className?: string }) {
  return <Link href={href} className={cn("inline-flex items-center gap-2 font-semibold text-primary", className)}>
    <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground" aria-hidden="true"><Braces className="size-4" /></span>
    <span>{BRAND.name}{suffix && <span className="font-normal text-muted-foreground"> · {suffix}</span>}</span>
  </Link>;
}
