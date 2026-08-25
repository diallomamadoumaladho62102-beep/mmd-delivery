"use client";

import { useState } from "react";
import {
  checkPhoneVerificationRequest,
  startPhoneVerificationRequest,
} from "@mmd/phone-verify-api";
import { useWebI18n } from "@/components/WebI18nProvider";
import { supabase } from "@/lib/supabaseBrowser";

type Props = {
  phone: string;
  verified: boolean;
  onVerified?: (phoneE164: string) => void;
};

async function getAccessToken(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token?.trim() ?? "";
}

function apiBaseUrl(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}

export default function PhoneVerifyCard({ phone, verified, onVerified }: Props) {
  const { t } = useWebI18n();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (verified) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        {t("client.phoneVerify.verified")}
      </div>
    );
  }

  async function start() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const token = await getAccessToken();
    const started = await startPhoneVerificationRequest({
      apiBaseUrl: apiBaseUrl(),
      accessToken: token,
      phone,
    });
    setBusy(false);
    if (started.ok === false) {
      setError(started.error || t("client.phoneVerify.sendFailed"));
      return;
    }
    setNotice(t("client.phoneVerify.codeSent"));
  }

  async function check() {
    setBusy(true);
    setError(null);
    const token = await getAccessToken();
    const checked = await checkPhoneVerificationRequest({
      apiBaseUrl: apiBaseUrl(),
      accessToken: token,
      phone,
      code,
    });
    setBusy(false);
    if (checked.ok === false) {
      setError(checked.error || t("client.phoneVerify.invalidCode"));
      return;
    }
    setNotice(t("client.phoneVerify.verifiedNotice"));
    onVerified?.(String(checked.phone_e164 ?? phone));
  }

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-sm font-semibold text-slate-800">
        {t("client.phoneVerify.title")}
      </p>
      <p className="text-xs text-slate-500">{t("client.phoneVerify.hint")}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !phone.trim()}
          onClick={() => void start()}
          className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {t("client.phoneVerify.sendCode")}
        </button>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t("client.phoneVerify.codePlaceholder")}
          className="w-28 rounded-lg border border-slate-300 px-2 py-2 text-sm"
        />
        <button
          type="button"
          disabled={busy || !code.trim()}
          onClick={() => void check()}
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-50"
        >
          {t("client.phoneVerify.confirm")}
        </button>
      </div>
      {notice ? <p className="text-xs text-emerald-700">{notice}</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
