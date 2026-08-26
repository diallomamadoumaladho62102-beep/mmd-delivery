"use client";

import { useState, type FormEvent } from "react";
import {
  SMS_LEGAL_LINKS,
  SMS_PROGRAM_COPY,
  type SmsProgramCopy,
  type SmsProgramLocale,
} from "./smsProgramCopy";
import { sitePrimaryBtnClass } from "./siteTheme";

export function SmsConsentCheckbox(props: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  optionalNote?: string;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={props.id} className="flex items-start gap-3 text-sm leading-relaxed text-slate-200">
        <input
          id={props.id}
          type="checkbox"
          checked={props.checked}
          onChange={(event) => props.onChange(event.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 rounded border-white/30 bg-slate-950"
        />
        <span>{props.label}</span>
      </label>
      {props.optionalNote ? (
        <p className="pl-7 text-xs text-slate-400">{props.optionalNote}</p>
      ) : null}
    </div>
  );
}

export default function SmsOptInForm({
  copy,
  source = "public_cta",
}: {
  copy: SmsProgramCopy;
  source?: "public_cta" | "web_signup";
}) {
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "ok" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!consent) {
      setStatus("error");
      setError(copy.errorConsent);
      return;
    }
    setStatus("sending");
    try {
      const res = await fetch("/api/sms/opt-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          consent,
          locale: copy.locale,
          source,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setStatus("error");
        setError(
          json.error === "Enter a valid mobile number."
            ? copy.errorPhone
            : json.error || copy.errorGeneric,
        );
        return;
      }
      setStatus("ok");
    } catch {
      setStatus("error");
      setError(copy.errorGeneric);
    }
  }

  if (status === "ok") {
    return (
      <div
        id="sms-opt-in-success"
        className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-5"
      >
        <h3 className="text-lg font-semibold text-white">{copy.successTitle}</h3>
        <p className="mt-2 text-sm leading-relaxed text-emerald-100">{copy.successBody}</p>
      </div>
    );
  }

  return (
    <form
      id="sms-opt-in"
      onSubmit={(event) => void onSubmit(event)}
      className="space-y-5 rounded-2xl border border-white/10 bg-slate-950/70 p-5"
    >
      <div>
        <label htmlFor="sms-opt-in-phone" className="text-sm font-medium text-slate-200">
          {copy.phoneLabel}
        </label>
        <input
          id="sms-opt-in-phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder={copy.phonePlaceholder}
          className="mt-1 w-full rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-orange-400/50 focus:outline-none focus:ring-1 focus:ring-orange-400/40"
        />
      </div>

      <SmsConsentCheckbox
        id="sms-opt-in-consent"
        checked={consent}
        onChange={setConsent}
        label={copy.checkboxLabel}
        optionalNote={copy.optionalNote}
      />

      <p className="text-xs text-slate-400">
        <a className="text-orange-300 underline" href={SMS_LEGAL_LINKS.privacy}>
          {copy.privacyLabel}
        </a>
        {" · "}
        <a className="text-orange-300 underline" href={SMS_LEGAL_LINKS.terms}>
          {copy.termsLabel}
        </a>
        {" · "}
        <a className="text-orange-300 underline" href={SMS_LEGAL_LINKS.support}>
          {copy.supportLabel}
        </a>
      </p>

      <button
        type="submit"
        disabled={status === "sending"}
        className={sitePrimaryBtnClass}
      >
        {copy.submitLabel}
      </button>

      {error ? <p className="text-sm text-red-300">{error}</p> : null}
    </form>
  );
}

export function SmsProgramLocaleToggle({
  locale,
  onChange,
}: {
  locale: SmsProgramLocale;
  onChange: (next: SmsProgramLocale) => void;
}) {
  return (
    <div className="flex gap-2" role="group" aria-label="Language">
      {(["en", "fr"] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => onChange(code)}
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            locale === code
              ? "bg-orange-400 text-slate-950"
              : "border border-white/20 text-slate-300"
          }`}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export function useSmsProgramCopy(locale: SmsProgramLocale): SmsProgramCopy {
  return SMS_PROGRAM_COPY[locale];
}
