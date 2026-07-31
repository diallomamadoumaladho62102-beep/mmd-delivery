"use client";

import { useState, type FormEvent } from "react";
import { sitePrimaryBtnClass } from "./siteTheme";

type Props = {
  title?: string;
  subtitle?: string;
};

export default function ContactForm({ title, subtitle }: Props) {
  const [status, setStatus] = useState<"idle" | "sending" | "ok" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: String(fd.get("name") ?? "").trim(),
      email: String(fd.get("email") ?? "").trim(),
      phone: String(fd.get("phone") ?? "").trim() || undefined,
      subject: String(fd.get("subject") ?? "").trim() || undefined,
      message: String(fd.get("message") ?? "").trim(),
    };
    try {
      const res = await fetch("/api/site/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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

  const fieldClass =
    "mt-1 w-full rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2.5 " +
    "text-sm text-white placeholder:text-slate-500 " +
    "focus:border-orange-400/50 focus:outline-none focus:ring-1 focus:ring-orange-400/40";

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-xl space-y-4" noValidate>
      {title ? <h3 className="text-xl font-semibold text-white">{title}</h3> : null}
      {subtitle ? <p className="text-sm text-slate-400">{subtitle}</p> : null}

      <div>
        <label htmlFor="site-contact-name" className="text-sm font-medium text-slate-300">
          Name
        </label>
        <input
          id="site-contact-name"
          name="name"
          required
          autoComplete="name"
          className={fieldClass}
        />
      </div>
      <div>
        <label htmlFor="site-contact-email" className="text-sm font-medium text-slate-300">
          Email
        </label>
        <input
          id="site-contact-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className={fieldClass}
        />
      </div>
      <div>
        <label htmlFor="site-contact-phone" className="text-sm font-medium text-slate-300">
          Phone <span className="text-slate-500">(optional)</span>
        </label>
        <input
          id="site-contact-phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          className={fieldClass}
        />
      </div>
      <div>
        <label htmlFor="site-contact-subject" className="text-sm font-medium text-slate-300">
          Subject <span className="text-slate-500">(optional)</span>
        </label>
        <input id="site-contact-subject" name="subject" className={fieldClass} />
      </div>
      <div>
        <label htmlFor="site-contact-message" className="text-sm font-medium text-slate-300">
          Message
        </label>
        <textarea
          id="site-contact-message"
          name="message"
          required
          rows={5}
          className={fieldClass}
        />
      </div>

      <button
        type="submit"
        disabled={status === "sending"}
        className={sitePrimaryBtnClass}
        data-site-event="contact_submit"
      >
        {status === "sending" ? "Sending…" : "Send message"}
      </button>

      {status === "ok" ? (
        <p className="text-sm text-emerald-400" role="status">
          Thanks — we received your message.
        </p>
      ) : null}
      {status === "error" && error ? (
        <p className="text-sm text-rose-400" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
