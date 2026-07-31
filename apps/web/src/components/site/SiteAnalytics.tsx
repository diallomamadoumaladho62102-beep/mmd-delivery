"use client";

import { useEffect } from "react";

function postEvent(event_name: string, path: string, meta?: Record<string, unknown>) {
  try {
    const body = JSON.stringify({ event_name, path, meta: meta ?? {} });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon("/api/site/analytics", blob);
      return;
    }
    void fetch("/api/site/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
  } catch {
    /* ignore analytics failures */
  }
}

export default function SiteAnalytics() {
  useEffect(() => {
    const path =
      typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search}`
        : "/";
    postEvent("page_view", path);

    function onClick(e: MouseEvent) {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const el = target.closest("[data-site-event]");
      if (!el) return;
      const eventName = el.getAttribute("data-site-event");
      if (!eventName) return;
      const clickPath =
        typeof window !== "undefined"
          ? `${window.location.pathname}${window.location.search}`
          : "/";
      postEvent(eventName, clickPath, {
        href: el.getAttribute("href") || undefined,
      });
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
