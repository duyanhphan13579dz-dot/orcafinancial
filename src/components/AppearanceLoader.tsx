"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth/context";
import { applyAppearance } from "@/components/settings/AppearancePanel";

/**
 * Applies the logged-in user's saved appearance preferences (theme, accent
 * colour, font scale, language) to <html> on every page load.
 *
 * Renders nothing. Safe when logged out — simply does nothing.
 */
export function AppearanceLoader() {
  const { isLoggedIn } = useAuth();

  useEffect(() => {
    if (!isLoggedIn) {
      // Reset to defaults when signed out.
      document.documentElement.classList.remove("theme-light");
      document.documentElement.style.removeProperty("--orca-cyan");
      document.documentElement.style.removeProperty("font-size");
      return;
    }
    let cancelled = false;
    fetch("/api/v1/users/preferences")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.data?.preferences) return;
        applyAppearance(j.data.preferences);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  return null;
}
