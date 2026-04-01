"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type TinType = "SSN" | "EIN";

type W9GetResponse =
  | { status: "missing" }
  | {
      status: "signed";
      signedAt: string | null;
      tin: { type: TinType; masked: string };
      profile: { legalName: string; entityType: string };
      file: { bucket: string; path: string; signedUrl: string | null } | null;
    };

type W9PostResponse =
  | {
      status: "signed";
      signedAt: string;
      tin: { type: TinType; masked: string };
      file: { signedUrl: string };
    }
  | { error: string };

function onlyDigits(s: string) {
  return String(s || "").replace(/\D+/g, "");
}

export default function DriverW9Page() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [status, setStatus] = useState<"missing" | "signed">("missing");
  const [signedAt, setSignedAt] = useState<string | null>(null);
  const [maskedTin, setMaskedTin] = useState<string | null>(null);

  const [legalName, setLegalName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [entityType, setEntityType] = useState("Individual/sole proprietor");
  const [address1, setAddress1] = useState("");
  const [address2, setAddress2] = useState("");
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("NJ");
  const [zip, setZip] = useState("");

  const [tinType, setTinType] = useState<TinType>("SSN");
  const [tin, setTin] = useState(""); // user input only
  const [signedName, setSignedName] = useState("");

  const tinDigits = useMemo(() => onlyDigits(tin), [tin]);
  const hasTinInput = useMemo(() => tinDigits.length > 0, [tinDigits]);

  function setFail(m: string) {
    setErr(m);
    setOkMsg(null);
    setSubmitting(false);
  }

  async function getAccessToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function loadStatus() {
    setLoading(true);
    setErr(null);
    setOkMsg(null);

    const token = await getAccessToken();
    if (!token) {
      setErr("No session. Please sign in.");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/driver/tax/w9", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const json = (await res.json().catch(() => null)) as any;

    if (!res.ok) {
      setErr(json?.error ?? "Failed to load W-9 status");
      setLoading(false);
      return;
    }

    const data = json as W9GetResponse;

    if (data.status === "missing") {
      setStatus("missing");
      setSignedAt(null);
      setMaskedTin(null);
      setTin(""); // ✅ never prefill TIN
    } else {
      setStatus("signed");
      setSignedAt(data.signedAt ?? null);
      setMaskedTin(data.tin?.masked ?? null);
      setTin(""); // ✅ never prefill TIN

      setLegalName(data.profile?.legalName ?? "");
      setEntityType(data.profile?.entityType ?? "Individual/sole proprietor");
      setSignedName(data.profile?.legalName ?? "");
    }

    setLoading(false);
  }

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Live validation (Stripe/Uber vibe) ----------
  const legalOk = useMemo(() => legalName.trim().length > 0, [legalName]);
  const entityOk = useMemo(() => entityType.trim().length > 0, [entityType]);
  const addressOk = useMemo(() => address1.trim().length > 0, [address1]);
  const cityOk = useMemo(() => city.trim().length > 0, [city]);
  const stateOk = useMemo(() => stateCode.trim().length >= 2, [stateCode]);
  const zipOk = useMemo(() => zip.trim().length > 0, [zip]);
  const signedOk = useMemo(() => signedName.trim().length > 0, [signedName]);

  const tinOk = useMemo(() => {
    if (status === "missing") return tinDigits.length === 9;
    // signed: allow empty (keep existing), but if provided must be 9 digits
    if (!hasTinInput) return true;
    return tinDigits.length === 9;
  }, [status, tinDigits, hasTinInput]);

  const canSubmit = useMemo(() => {
    if (loading) return false;
    if (submitting) return false;
    if (!legalOk || !entityOk || !addressOk || !cityOk || !stateOk || !zipOk || !signedOk) return false;
    if (!tinOk) return false;
    return true;
  }, [loading, submitting, legalOk, entityOk, addressOk, cityOk, stateOk, zipOk, signedOk, tinOk]);

  const checklist = useMemo(
    () => [
      { label: "Legal name", ok: legalOk },
      { label: "Entity type", ok: entityOk },
      { label: "Address", ok: addressOk },
      { label: "City", ok: cityOk },
      { label: "State", ok: stateOk },
      { label: "ZIP", ok: zipOk },
      {
        label:
          status === "missing"
            ? `TIN (${tinType}) • required`
            : `TIN (${tinType}) • optional (blank keeps current)`,
        ok: tinOk,
      },
      { label: "Signed name", ok: signedOk },
    ],
    [legalOk, entityOk, addressOk, cityOk, stateOk, zipOk, tinOk, status, tinType, signedOk]
  );

  async function submit() {
    setSubmitting(true);
    setErr(null);
    setOkMsg(null);

    const token = await getAccessToken();
    if (!token) {
      setFail("No session. Please sign in.");
      return;
    }

    // Guard: don’t submit if not valid (even if button somehow clicked)
    if (!canSubmit) {
      setFail("Please complete the required fields before submitting.");
      return;
    }

    const payload: any = {
      legal_name: legalName.trim(),
      business_name: businessName.trim(),
      entity_type: entityType.trim(),
      address_line1: address1.trim(),
      address_line2: address2.trim(),
      city: city.trim(),
      state: stateCode.trim().toUpperCase(),
      zip: zip.trim(),
      tin_type: tinType,
      signed_name: signedName.trim(),
    };

    if (hasTinInput) payload.tin = tin; // send only if user typed

    const res = await fetch("/api/driver/tax/w9", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const json = (await res.json().catch(() => null)) as W9PostResponse | any;

    if (!res.ok) {
      setFail(json?.error ?? "Failed to submit W-9");
      return;
    }

    setOkMsg("W-9 submitted successfully.");
    setTin(""); // ✅ clear full TIN immediately
    await loadStatus();
    setSubmitting(false);
  }

  return (
    <main className="min-h-screen p-6 md:p-10">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">W-9</h1>
            <p className="mt-1 text-sm text-gray-600">
              Complete or update your W-9. Your full TIN is never displayed back to you.
            </p>
          </div>

          <a className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50" href="/driver/tax">
            Back
          </a>
        </div>

        <div className="mt-6 rounded-xl border bg-white p-5 shadow-sm">
          {loading ? (
            <p className="text-sm text-gray-600">Loading…</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm">
                  <span className="font-medium">Status:</span>{" "}
                  {status === "signed" ? (
                    <span className="text-green-700">Signed</span>
                  ) : (
                    <span className="text-yellow-700">Missing</span>
                  )}
                  {status === "signed" && signedAt ? (
                    <span className="ml-2 text-gray-600">({String(signedAt).slice(0, 10)})</span>
                  ) : null}
                </div>

                <button
                  onClick={loadStatus}
                  className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                  disabled={loading || submitting}
                >
                  Refresh
                </button>
              </div>

              {maskedTin ? (
                <p className="mt-2 text-xs text-gray-600">
                  Current TIN on file: <span className="font-medium">{maskedTin}</span>
                </p>
              ) : null}

              {err ? <p className="mt-3 text-sm text-red-600">{err}</p> : null}
              {okMsg ? <p className="mt-3 text-sm text-green-700">{okMsg}</p> : null}

              {/* ✅ Mini checklist */}
              <div className="mt-5 rounded-xl border bg-gray-50 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Checklist</p>
                  <span className={`text-xs ${canSubmit ? "text-green-700" : "text-gray-600"}`}>
                    {canSubmit ? "Ready to submit" : "Complete required fields"}
                  </span>
                </div>

                <ul className="mt-3 grid gap-2 text-sm">
                  {checklist.map((c) => (
                    <li key={c.label} className="flex items-center justify-between">
                      <span className="text-gray-700">{c.label}</span>
                      <span className={c.ok ? "text-green-700" : "text-gray-500"}>
                        {c.ok ? "✅" : "❌"}
                      </span>
                    </li>
                  ))}
                </ul>

                {!tinOk ? (
                  <p className="mt-3 text-xs text-red-600">
                    {status === "missing"
                      ? `${tinType} must be 9 digits`
                      : `If you enter a new ${tinType}, it must be 9 digits (or leave blank to keep current).`}
                  </p>
                ) : null}
              </div>

              <div className="mt-6 grid gap-4">
                <Field label="Legal name (required)" value={legalName} onChange={setLegalName} />
                <Field label="Business name (optional)" value={businessName} onChange={setBusinessName} />

                <div>
                  <label className="text-sm font-medium">Entity type (required)</label>
                  <select
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                    value={entityType}
                    onChange={(e) => setEntityType(e.target.value)}
                  >
                    <option>Individual/sole proprietor</option>
                    <option>Single-member LLC</option>
                    <option>C Corporation</option>
                    <option>S Corporation</option>
                    <option>Partnership</option>
                    <option>Trust/estate</option>
                    <option>Other</option>
                  </select>
                </div>

                <Field label="Address line 1 (required)" value={address1} onChange={setAddress1} />
                <Field label="Address line 2 (optional)" value={address2} onChange={setAddress2} />

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <Field label="City (required)" value={city} onChange={setCity} />
                  <Field label="State (required)" value={stateCode} onChange={(v) => setStateCode(v.toUpperCase())} />
                  <Field label="ZIP (required)" value={zip} onChange={setZip} />
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div>
                    <label className="text-sm font-medium">TIN type</label>
                    <select
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                      value={tinType}
                      onChange={(e) => setTinType(e.target.value as TinType)}
                    >
                      <option value="SSN">SSN</option>
                      <option value="EIN">EIN</option>
                    </select>
                  </div>

                  <div className="md:col-span-2">
                    <label className="text-sm font-medium">
                      TIN{" "}
                      <span className="text-gray-500">
                        ({status === "signed" ? "optional to update" : "required"} • 9 digits)
                      </span>
                    </label>
                    <input
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                      value={tin}
                      onChange={(e) => setTin(e.target.value)}
                      placeholder={
                        status === "signed"
                          ? "Leave blank to keep current TIN"
                          : tinType === "SSN"
                            ? "123-45-6789"
                            : "12-3456789"
                      }
                      inputMode="numeric"
                      autoComplete="off"
                    />
                    <p className="mt-1 text-xs text-gray-600">
                      We store your TIN encrypted and only keep the last 4 digits for display.
                    </p>
                  </div>
                </div>

                <Field label="Signed name (required)" value={signedName} onChange={setSignedName} />

                <button
                  onClick={submit}
                  disabled={!canSubmit}
                  className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {submitting ? "Submitting…" : status === "signed" ? "Update / Re-sign" : "Submit W-9"}
                </button>

                <p className="text-xs text-gray-600">
                  By submitting, you certify under penalties of perjury that the TIN is correct and you are a U.S. person (or U.S. resident alien).
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-sm font-medium">{label}</label>
      <input
        className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}