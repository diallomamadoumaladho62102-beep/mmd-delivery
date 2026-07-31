"use client";

import { useState, type FormEvent } from "react";
import { sitePrimaryBtnClass } from "./siteTheme";

export default function NewsletterForm() {
  const [status, setStatus] = useState<"idle" | "sending" | "ok" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "").trim();
    try {
      const res = await fetch("/api/site/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "footer" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("error");
        setError(String(json.error ?? "Something went wrong"));
        return;
      }
      setStatus("ok");
      e.currentTarget.reset();
    } catch {
      setStatus("error");
      setError("Network error. Please try again.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2" aria-label="Newsletter signup">
      <label htmlFor="site-newsletter-email" className="text-sm font-medium text-slate-300">
        Newsletter
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="site-newsletter-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@email.com"
          className="w-full rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-orange-400/50 focus:outline-none focus:ring-1 focus:ring-orange-400/40"
        />
        <button
          type="submit"
          disabled={status === "sending"}
          className={`${sitePrimaryBtnClass} shrink-0`}
          data-site-event="newsletter_subscribe"
        >
          {status === "sending" ? "…" : "Subscribe"}
        </button>
      </div>
      {status === "ok" ? (
        <p className="text-xs text-emerald-400" role="status">
          You are subscribed.
        </p>
      ) : null}
      {status === "error" && error ? (
        <p className="text-xs text-rose-400" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
