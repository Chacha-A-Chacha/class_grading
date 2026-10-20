"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/** Sends a JSON mutation, refreshes server data on success and keeps the error message. */
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  async function send<T = Record<string, unknown>>(url: string, method: "POST" | "PUT", body: object): Promise<T | null> {
    setBusy(true); setError("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) { if (result.code === "STALE_ASSESSMENT") setStale(true); throw new Error(result.message); }
      router.refresh();
      return result as T;
    } catch (e) { setError(e instanceof Error ? e.message : "The action failed. Try again."); return null; }
    finally { setBusy(false); }
  }
  return { busy, error, setError, stale, send, router };
}
