"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AWAY_NOTICE_MS, type AwayEvent, type AwayInterval, type DeviceInfo, RESIZE_SETTLE_MS, type SmallInterval, type WindowSize, nextAway, nextSmall, windowShare } from "@/shared/monitoring";

type NavigatorWithHints = Navigator & { userAgentData?: { mobile?: boolean; platform?: string } };
const RETURN_TITLE = "Return to your assessment";

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
  // Chromium exposes this without a permission prompt; elsewhere it is unknown, not false.
  const extended = (window.screen as Screen & { isExtended?: boolean }).isExtended;
  return { type: phone ? "phone" : touch && (os === "iOS" || os === "Android") ? "tablet" : "computer", os, multipleScreens: typeof extended === "boolean" ? extended : null };
}

/**
 * Reports when the exam page is hidden or loses focus, and on computers when the window is
 * smaller than the screen (specification §6). Observation only: the exam keeps running, and
 * reports are queued and retried like answers.
 */
export function useAwayTracking({ attemptId, generation, enabled }: { attemptId: string; generation: number; enabled: boolean }) {
  const [awaySeconds, setAwaySeconds] = useState<number | null>(null);
  const [smallWindow, setSmallWindow] = useState<WindowSize | null>(null);
  const away = useRef<AwayInterval | null>(null);
  const small = useRef<SmallInterval | null>(null);
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
    const title = document.title;
    const times = (i: { startedAt: number; endedAt: number | null }) => ({ startedAt: new Date(i.startedAt).toISOString(), endedAt: i.endedAt === null ? null : new Date(i.endedAt).toISOString() });
    const enqueue = (event: AwayEvent) => { queue.current.set(event.clientEventId, event); void flush(); };
    const common = () => ({ sessionGeneration: generation, device: device.current! });

    const evaluateAway = () => {
      const hidden = document.visibilityState === "hidden";
      // The tab strip and taskbar still show the title while the student is elsewhere.
      document.title = hidden ? RETURN_TITLE : title;
      const { current, report } = nextAway(away.current, { hidden, focused: document.hasFocus() }, Date.now(), () => crypto.randomUUID());
      away.current = current;
      if (!report) return;
      enqueue({ kind: "AWAY", clientEventId: report.clientEventId, reasons: report.reasons, ...times(report), ...common() });
      if (report.endedAt !== null && report.endedAt - report.startedAt > AWAY_NOTICE_MS) setAwaySeconds(Math.round((report.endedAt - report.startedAt) / 1000));
    };
    // Window size matters on computers, where another window can sit beside the exam.
    const evaluateSize = () => {
      if (device.current!.type !== "computer") return;
      const size = windowShare(window, window.screen);
      const { current, report } = nextSmall(small.current, size, Date.now(), () => crypto.randomUUID());
      small.current = current;
      setSmallWindow(current ? current.size : null);
      if (report) enqueue({ kind: "SMALL_WINDOW", clientEventId: report.clientEventId, size: report.size, ...times(report), ...common() });
    };

    // blur fires before visibilitychange for one tab switch; evaluating after both keeps it one interval.
    const later = () => setTimeout(evaluateAway, 0);
    let settle: ReturnType<typeof setTimeout> | undefined;
    const resized = () => { clearTimeout(settle); settle = setTimeout(evaluateSize, RESIZE_SETTLE_MS); };
    window.addEventListener("blur", later); window.addEventListener("focus", later);
    document.addEventListener("visibilitychange", later); window.addEventListener("pagehide", evaluateAway);
    window.addEventListener("resize", resized); window.addEventListener("online", flush);
    const retry = setInterval(() => { evaluateSize(); void flush(); }, 15_000);
    evaluateAway(); evaluateSize();
    return () => {
      window.removeEventListener("blur", later); window.removeEventListener("focus", later);
      document.removeEventListener("visibilitychange", later); window.removeEventListener("pagehide", evaluateAway);
      window.removeEventListener("resize", resized); window.removeEventListener("online", flush);
      clearInterval(retry); clearTimeout(settle); document.title = title;
    };
  }, [enabled, generation, flush]);

  return { awaySeconds, dismiss: () => setAwaySeconds(null), smallWindow };
}
