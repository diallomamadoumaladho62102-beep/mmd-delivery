"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type W9Status =
  | { status: "missing" }
  | {
      status: "signed";
      signedAt: string | null;
      tin: { type: "SSN" | "EIN"; masked: string };
      profile: { legalName: string; entityType: string };
      file: { bucket: string; path: string; signedUrl: string | null } | null;
    };

export default function DriverTaxCenterPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [w9, setW9] = useState<W9Status | null>(null);

  async function fetchW9() {
    setLoading(true);
    setErr(null);

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      setErr("No session. Please sign in.");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/driver/tax/w9", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      setErr(json?.error ?? "Failed to load W-9 status");
      setLoading(false);
      return;
    }

    setW9(json?.status === "signed" ? json : { status: "missing" });
    setLoading(false);
  }

  useEffect(() => {
    fetchW9();
  }, []);

  const signedUrl = (w9 && w9.status === "signed" && w9.file?.signedUrl) || null;

  return (
    <main className="min-h-screen p-6 md:p-10">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-semibold">Tax Center</h1>
        <p className="mt-1 text-sm text-gray-600">
          Manage your tax documents (W-9 now, 1099 coming next).
        </p>

        <div className="mt-6 rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-medium">W-9</h2>
              <p className="text-sm text-gray-600">Tax information certification</p>
            </div>

            <button
              onClick={fetchW9}
              className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
              disabled={loading}
            >
              Refresh
            </button>
          </div>

          <div className="mt-4">
            {loading ? (
              <p className="text-sm text-gray-600">Loading…</p>
            ) : err ? (
              <p className="text-sm text-red-600">{err}</p>
            ) : !w9 ? (
              <p className="text-sm text-gray-600">No data.</p>
            ) : w9.status === "missing" ? (
              <div className="rounded-lg bg-yellow-50 p-4">
                <p className="text-sm font-medium text-yellow-900">W-9 not signed yet</p>
                <p className="mt-1 text-sm text-yellow-800">
                  Please complete your W-9 to enable 1099 generation.
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <a
                    href="/driver/tax/w9"
                    className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:opacity-90"
                  >
                    Complete W-9
                  </a>
                </div>
              </div>
            ) : (
              <div className="rounded-lg bg-green-50 p-4">
                <p className="text-sm font-medium text-green-900">Signed</p>

                <div className="mt-3 grid gap-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-600">Legal name</span>
                    <span className="font-medium text-gray-900">{w9.profile.legalName}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-600">Entity type</span>
                    <span className="font-medium text-gray-900">{w9.profile.entityType}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-600">TIN</span>
                    <span className="font-medium text-gray-900">{w9.tin.masked}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-600">Signed at</span>
                    <span className="font-medium text-gray-900">
                      {w9.signedAt ? String(w9.signedAt).slice(0, 10) : "—"}
                    </span>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {signedUrl ? (
                    <a
                      href={signedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:opacity-90"
                    >
                      Download W-9 PDF
                    </a>
                  ) : (
                    <button
                      onClick={fetchW9}
                      className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:opacity-90"
                    >
                      Get download link
                    </button>
                  )}

                  <a
                    href="/driver/tax/w9"
                    className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50"
                  >
                    Update / Re-sign
                  </a>
                </div>

                <p className="mt-3 text-xs text-gray-600">
                  For security, your full TIN is never shown. Only the last 4 digits appear.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-medium">1099</h2>
          <p className="text-sm text-gray-600">
            Coming next: yearly 1099 generation + download by year.
          </p>
        </div>
      </div>
    </main>
  );
}
