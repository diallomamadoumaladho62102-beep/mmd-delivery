"use client";

import { useState } from "react";

type Props = {
  phone: string;
  verified: boolean;
  onVerified?: (phoneE164: string) => void;
};

export default function PhoneVerifyCard({ phone, verified, onVerified }: Props) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (verified) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        Phone verified
      </div>
    );
  }

  async function start() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fetch("/api/auth/phone/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Unable to send code");
      return;
    }
    setNotice("Verification code sent by SMS.");
  }

  async function check() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/phone/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, code }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Invalid code");
      return;
    }
    setNotice("Phone verified.");
    onVerified?.(String(body.phone_e164 ?? phone));
  }

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-sm font-semibold text-slate-800">Verify phone (Twilio Verify)</p>
      <p className="text-xs text-slate-500">
        Required for full access when PHONE_OTP_ENABLED is on.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !phone.trim()}
          onClick={() => void start()}
          className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          Send SMS code
        </button>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Code"
          className="w-28 rounded-lg border border-slate-300 px-2 py-2 text-sm"
        />
        <button
          type="button"
          disabled={busy || !code.trim()}
          onClick={() => void check()}
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-50"
        >
          Confirm
        </button>
      </div>
      {notice ? <p className="text-xs text-emerald-700">{notice}</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
