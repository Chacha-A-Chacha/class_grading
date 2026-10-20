"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

/** Re-renders server data on an interval while switched on. */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(timer);
  }, [on, seconds, router]);
  return <div className="flex items-center gap-2"><Checkbox id="auto-refresh" checked={on} onCheckedChange={(c) => setOn(c === true)} /><Label htmlFor="auto-refresh" className="font-normal">Refresh every {seconds} seconds</Label></div>;
}
