"use client";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function Logout() {
  const router = useRouter();
  const pathname = usePathname();
  const [error, setError] = useState(false);
  return <div><Button variant="outline" onClick={async () => {
    // Specification §6: warn before sign-out could discard work during an assessment.
    if (pathname.startsWith("/student/attempts/") && !window.confirm("Sign out during the assessment? Answers that are still being saved may be lost, and the timer keeps running.")) return;
    try { const response = await fetch("/api/v1/auth/logout", { method: "POST" }); if (!response.ok) throw new Error(); router.replace("/sign-in"); router.refresh(); }
    catch { setError(true); }
  }}>Sign out</Button>{error && <Alert variant="destructive" className="mt-3"><AlertDescription>Sign-out failed. Try again.</AlertDescription></Alert>}</div>;
}
