"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AWAY_NOTICE_MS, type AwayEvent, type AwayInterval, type DeviceInfo, nextAway } from "@/shared/monitoring";

type NavigatorWithHints = Navigator & { userAgentData?: { mobile?: boolean; platform?: string } };

/** Coarse device class and OS only: enough for a reviewer to read phone app switches fairly. */
function deviceInfo(): DeviceInfo {
  const nav = navigator as NavigatorWithHints, ua = nav.userAgent;
  const hint = nav.userAgentData?.platform ?? "";
  const os: DeviceInfo["os"] = /android/i.test(hint + ua) ? "Android"
    : /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && nav.maxTouchPoints > 1) ? "iOS"
    : /windows/i.test(hint + ua) ? "Windows" : /cros/i.test(ua) || /chrome os/i.test(hint) ? "ChromeOS"
    : /mac/i.test(hint + ua) ? "macOS" : /linux/i.test(hint + ua) ? "Linux" : "Other";
  const touch = window.matchMedia("(pointer: coarse)").matches;
  const phone = nav.userAgentData?.mobile ?? /mobi|iphone|ipod/i.test(ua);
  return { type: phone ? "phone" : touch && (os === "iOS" || os === "Android") ? "tablet" : "computer", os };
}

/**
 * Reports when the exam page is hidden or loses focus (specification §6). Observation only:
 * the exam keeps running, and reports are queued and retried like answers.
 */
export function useAwayTracking({ attemptId, generation, enabled }: { attemptId: string; generation: number; enabled: boolean }) {
  const [notice, setNotice] = useState<number | null>(null);
  const current = useRef<AwayInterval | null>(null);
  const queue = useRef(new Map<string, AwayEvent>());
  const sending = useRef(false);
  const device = useRef<DeviceInfo | null>(null);

  const flush = useCallback(async () => {
    if (!enabled || sending.current || !queue.current.size) return;
    sending.current = true;
    const batch = [...queue.current.values()].slice(0, 20);
    try {
      // keepalive lets the report finish while the tab is being hidden or closed.
      const response = await fetch(`/api/v1/attempts/${attemptId}/events`, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events: batch }) });
      // Retry later on network or server trouble; drop reports the server refuses outright.
      if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
        for (const e of batch) if (queue.current.get(e.clientEventId) === e) queue.current.delete(e.clientEventId);
      }
    } catch { /* offline: kept for the next attempt */ }
    finally { sending.current = false; }
  }, [attemptId, enabled]);

  useEffect(() => {
    if (!enabled) return;
    device.current = deviceInfo();
    const enqueue = (interval: AwayInterval) => {
      queue.current.set(interval.clientEventId, {
        clientEventId: interval.clientEventId, sessionGeneration: generation, reasons: interval.reasons, device: device.current!,
        startedAt: new Date(interval.startedAt).toISOString(), endedAt: interval.endedAt === null ? null : new Date(interval.endedAt).toISOString(),
      });
      void flush();
    };
    const evaluate = () => {
      const { current: next, report } = nextAway(current.current, { hidden: document.visibilityState === "hidden", focused: document.hasFocus() }, Date.now(), () => crypto.randomUUID());
      current.current = next;
      if (!report) return;
      enqueue(report);
      if (report.endedAt !== null && report.endedAt - report.startedAt > AWAY_NOTICE_MS) setNotice(Math.round((report.endedAt - report.startedAt) / 1000));
    };
    // blur fires before visibilitychange for one tab switch; evaluating after both keeps it one interval.
    const later = () => setTimeout(evaluate, 0);
    window.addEventListener("blur", later); window.addEventListener("focus", later);
    document.addEventListener("visibilitychange", later); window.addEventListener("pagehide", evaluate);
    window.addEventListener("online", flush);
    const retry = setInterval(() => void flush(), 15_000);
    evaluate();
    return () => {
      window.removeEventListener("blur", later); window.removeEventListener("focus", later);
      document.removeEventListener("visibilitychange", later); window.removeEventListener("pagehide", evaluate);
      window.removeEventListener("online", flush); clearInterval(retry);
    };
  }, [enabled, generation, flush]);

  return { awaySeconds: notice, dismiss: () => setNotice(null) };
}
