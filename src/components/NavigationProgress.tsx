"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

const PRIMARY_ROUTES = [
  "/",
  "/heatmap",
  "/crypto",
  "/forex",
  "/commodities",
  "/sector-board",
  "/reports",
  "/news",
  "/screener",
  "/watchlist",
  "/agent",
  "/settings",
  "/system",
];

/**
 * Lightweight top progress indicator + idle prefetch.
 * Starts on internal link interaction, completes when pathname settles.
 * Avoids heavy dependencies (no nprogress).
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const router = useRouter();
  const [active, setActive] = useState(false);
  const [pct, setPct] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPath = useRef(pathname);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (completeRef.current) {
      clearTimeout(completeRef.current);
      completeRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    clearTimers();
    setActive(true);
    setPct(12);
    timerRef.current = setInterval(() => {
      setPct((p) => {
        if (p >= 88) return p;
        // Ease toward ~90% while waiting for navigation
        const step = p < 40 ? 8 : p < 70 ? 3.5 : 1.2;
        return Math.min(88, p + step);
      });
    }, 120);
  }, [clearTimers]);

  const finish = useCallback(() => {
    clearTimers();
    setPct(100);
    completeRef.current = setTimeout(() => {
      setActive(false);
      setPct(0);
    }, 180);
  }, [clearTimers]);

  // Complete when route actually changes
  useEffect(() => {
    if (pathname !== lastPath.current) {
      lastPath.current = pathname;
      finish();
    }
  }, [pathname, finish]);

  // Capture internal navigation intent early (pointerdown feels snappier than click)
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.("a[href]");
      if (!el) return;
      const a = el as HTMLAnchorElement;
      if (a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:"))
        return;
      // Same-origin only
      try {
        const url = new URL(href, window.location.origin);
        if (url.origin !== window.location.origin) return;
        const next = url.pathname + url.search;
        const cur = window.location.pathname + window.location.search;
        if (next === cur) return;
        start();
      } catch {
        /* ignore */
      }
    };

    // Safety: if something blocks navigation, auto-finish after 6s
    const onVisibility = () => {
      if (document.visibilityState === "hidden") finish();
    };

    document.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimers();
    };
  }, [start, finish, clearTimers]);

  // Idle prefetch of primary routes (once, after first paint)
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      for (const route of PRIMARY_ROUTES) {
        try {
          router.prefetch(route);
        } catch {
          /* ignore */
        }
      }
    };

    // Prefer requestIdleCallback; fallback to short timeout
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ric = (window as any).requestIdleCallback as
      | undefined
      | ((cb: () => void, opts?: { timeout: number }) => number);
    let id: number | ReturnType<typeof setTimeout>;
    if (typeof ric === "function") {
      id = ric(run, { timeout: 2500 });
    } else {
      id = setTimeout(run, 800);
    }
    return () => {
      cancelled = true;
      if (typeof ric === "function" && typeof id === "number") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).cancelIdleCallback?.(id);
      } else {
        clearTimeout(id as ReturnType<typeof setTimeout>);
      }
    };
  }, [router]);

  if (!active && pct === 0) return null;

  return (
    <div
      className="pointer-events-none fixed left-0 right-0 top-0 z-[100] h-[2px]"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-hidden={!active}
    >
      <div
        className="h-full bg-gradient-to-r from-[#00d4ff] via-[#38bdf8] to-[#00d4ff] shadow-[0_0_12px_rgba(0,212,255,0.65)] transition-[width,opacity] duration-150 ease-out"
        style={{
          width: `${pct}%`,
          opacity: active || pct > 0 ? 1 : 0,
        }}
      />
    </div>
  );
}
