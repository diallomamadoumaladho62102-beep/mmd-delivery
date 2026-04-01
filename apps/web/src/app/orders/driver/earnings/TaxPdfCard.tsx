// apps/web/src/app/orders/driver/earnings/TaxPdfCard.tsx
"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type ApiOk = {
  routeVersion?: string;
  year: number;
  driverId: string;
  file: {
    bucket: string;
    path: string;
    signedUrl: string;
    expiresInSeconds: number;
  };
};

type ApiErr = {
  error?: string;
  hint?: string;
  bucket?: string;
  path?: string;
  routeVersion?: string;
};

function currentYearUTC() {
  return new Date().getUTCFullYear();
}

function formatApiError(e: any) {
  const payload = (e?.payload ?? null) as ApiErr | null;

  const parts: string[] = [];
  const main =
    payload?.error ||
    e?.message ||
    (typeof e === "string" ? e : null) ||
    "Erreur inconnue";
  parts.push(main);

  if (payload?.hint) parts.push(payload.hint);
  if (payload?.bucket || payload?.path) {
    parts.push(
      `(${payload.bucket ? `bucket=${payload.bucket}` : ""}${
        payload.bucket && payload.path ? ", " : ""
      }${payload.path ? `path=${payload.path}` : ""})`
    );
  }
  if (payload?.routeVersion) parts.push(`route=${payload.routeVersion}`);

  return parts.filter(Boolean).join(" ");
}

export default function TaxPdfCard() {
  const years = useMemo(() => {
    const y = currentYearUTC();
    // Année courante + 3 ans en arrière (stable order)
    return [y, y - 1, y - 2, y - 3];
  }, []);

  const [year, setYear] = useState<number>(years[1] ?? currentYearUTC() - 1);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function getAccessToken() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error(error.message);
    const token = data?.session?.access_token;
    if (!token) throw new Error("Not authenticated (no session access_token).");
    return token;
  }

  async function callJson<T>(url: string, token: string): Promise<T> {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    // Try parse JSON, but don't crash if not JSON
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }

    if (!res.ok) {
      const errMsg = json?.error || `HTTP ${res.status}`;
      const e = new Error(errMsg) as any;
      e.payload = json;
      e.status = res.status;
      throw e;
    }

    return (json ?? {}) as T;
  }

  function openSignedUrl(url: string) {
    // Attempt new tab; if blocked, tell user
    const w = window.open(url, "_blank", "noopener,noreferrer");
    if (!w) {
      setMsg(
        "⚠️ Pop-up bloqué par le navigateur. Autorise les pop-ups pour ouvrir le PDF."
      );
      return false;
    }
    return true;
  }

  async function download() {
    if (loading) return;
    setLoading(true);
    setMsg(null);

    try {
      const token = await getAccessToken();

      const data = await callJson<ApiOk>(
        `/api/driver/tax/download?year=${year}`,
        token
      );

      openSignedUrl(data.file.signedUrl);
      setMsg(`✅ Download prêt (year ${year}).`);
    } catch (e: any) {
      const status = e?.status;

      if (status === 404) {
        setMsg(
          `⚠️ PDF pas encore généré pour ${year}. Clique “Generate PDF” puis “Download”.`
        );
      } else {
        setMsg(`❌ ${formatApiError(e)}`);
      }
    } finally {
      setLoading(false);
    }
  }

  async function generateOnly() {
    if (loading) return;
    setLoading(true);
    setMsg(null);

    try {
      const token = await getAccessToken();

      // summary route returns JSON
      await callJson<any>(`/api/driver/tax/summary?year=${year}`, token);

      setMsg(`✅ PDF généré pour ${year}. Tu peux cliquer “Download PDF”.`);
    } catch (e: any) {
      setMsg(`❌ ${formatApiError(e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function generateThenDownload() {
    if (loading) return;
    setLoading(true);
    setMsg(null);

    try {
      const token = await getAccessToken();

      // 1) Generate
      await callJson<any>(`/api/driver/tax/summary?year=${year}`, token);

      // 2) Download (increments download_count)
      const data = await callJson<ApiOk>(
        `/api/driver/tax/download?year=${year}`,
        token
      );

      openSignedUrl(data.file.signedUrl);
      setMsg(`✅ Généré + download OK (year ${year}).`);
    } catch (e: any) {
      setMsg(`❌ ${formatApiError(e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold">Tax PDF</div>
          <div className="text-sm text-neutral-600">
            Génère et télécharge ton résumé annuel (PDF) depuis le serveur.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-neutral-600">Year</label>
          <select
            className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            disabled={loading}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={download}
          disabled={loading}
          className="rounded-lg bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? "Please wait..." : "Download PDF"}
        </button>

        <button
          onClick={generateOnly}
          disabled={loading}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50"
        >
          Generate PDF
        </button>

        <button
          onClick={generateThenDownload}
          disabled={loading}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50"
        >
          Generate PDF + Download
        </button>
      </div>

      {msg ? (
        <div className="mt-3 rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-800">
          {msg}
        </div>
      ) : null}

      <div className="mt-3 text-xs text-neutral-500">
        Note: “Download” incrémente <code>download_count</code> et met à jour{" "}
        <code>last_downloaded_at</code>.
      </div>
    </div>
  );
}