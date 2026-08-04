"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageMarketing } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";
import type { SiteSettingsPayload } from "@/lib/siteCms";
import { getActiveSocialLinks } from "@mmd/social-links";
import SocialLinks from "@/components/site/SocialLinks";

const CARD = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
const INPUT = "mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";
const LABEL = "text-xs font-semibold uppercase tracking-wide text-slate-500";

function SettingsInner() {
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [jsonText, setJsonText] = useState("{}");

  const load = useCallback(async () => {
    setError(null);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageMarketing(session?.role ?? null));
    const http = await adminFetch("/api/admin/site/settings");
    const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
    if (!http.ok || res.ok === false) {
      setError(String(res.error ?? "Load failed"));
      return;
    }
    const settings = res.settings as { payload?: SiteSettingsPayload };
    setJsonText(JSON.stringify(settings?.payload ?? {}, null, 2));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      let payload: SiteSettingsPayload;
      try {
        payload = JSON.parse(jsonText) as SiteSettingsPayload;
      } catch {
        setError("Invalid JSON");
        return;
      }
      const http = await adminFetch("/api/admin/site/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      });
      const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
      if (!http.ok || res.ok === false) {
        setError(String(res.error ?? "Save failed"));
        return;
      }
      setNotice("Settings saved.");
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <Link href="/admin/site" className="text-sm font-semibold text-slate-500 hover:text-slate-800">
          ← Corporate Website
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Site settings</h1>
        <p className="mt-1 text-sm text-slate-600">
          Locale: en — brand, SEO, store links. Platform socials are centralized in{" "}
          <code className="rounded bg-slate-100 px-1">shared/socialLinks.ts</code>.
        </p>
      </div>

      <div className={`${CARD} space-y-3`}>
        <h2 className="text-sm font-semibold text-slate-900">Official social accounts</h2>
        <p className="text-sm text-slate-600">
          These links power the public footer, emails, download page, and mobile about screens.
          Edit{" "}
          <a href="/brand/social" className="font-medium text-orange-700 hover:underline">
            /brand/social
          </a>{" "}
          for the QR marketing kit.
        </p>
        <SocialLinks
          variant="footer"
          className="[&_a]:border-slate-200 [&_a]:bg-slate-50 [&_a]:text-slate-700 [&_a:hover]:border-orange-300 [&_a:hover]:text-orange-700"
        />
        <ul className="space-y-1 text-xs text-slate-500">
          {getActiveSocialLinks().map((link) => (
            <li key={link.id}>
              {link.label}
              {link.username ? ` (${link.username})` : ""}: {link.url}
            </li>
          ))}
        </ul>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {notice}
        </div>
      ) : null}

      <form onSubmit={onSave} className={`${CARD} space-y-4`}>
        <label className="block">
          <span className={LABEL}>Payload JSON</span>
          <textarea
            className={`${INPUT} min-h-[420px] font-mono text-xs`}
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            disabled={!canEdit}
          />
        </label>
        <button
          type="submit"
          disabled={!canEdit || saving}
          className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
      </form>
    </div>
  );
}

export default function SiteSettingsPage() {
  return (
    <AdminGate requiredPermission="marketing.read">
      <SettingsInner />
    </AdminGate>
  );
}
