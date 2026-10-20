"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function Logout() {
  const router = useRouter();
  const [error, setError] = useState(false);
  return <div><Button variant="outline" onClick={async () => {
    try { const response = await fetch("/api/v1/auth/logout", { method: "POST" }); if (!response.ok) throw new Error(); router.replace("/sign-in"); router.refresh(); }
    catch { setError(true); }
  }}>Sign out</Button>{error && <Alert variant="destructive" className="mt-3"><AlertDescription>Sign-out failed. Try again.</AlertDescription></Alert>}</div>;
}
