"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageMarketing } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

type AdRow = {
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string;
  button_text: string | null;
  button_action: string | null;
  placement: string;
  category: string;
  country: string | null;
  city: string | null;
  language: string | null;
  audience: string | null;
  priority: number;
  display_order: number;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  analytics?: { impressions: number; clicks: number; ctr: number };
};

const CARD = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
const INPUT = "mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";
const LABEL = "text-xs font-semibold uppercase tracking-wide text-slate-500";

const EMPTY_FORM = {
  id: "",
  title: "",
  subtitle: "",
  image_url: "",
  button_text: "Learn more",
  button_action: "food",
  placement: "client_home",
  category: "Campagnes MMD",
  country: "",
  city: "",
  language: "",
  audience: "",
  priority: "0",
  display_order: "0",
  start_date: "",
  end_date: "",
  is_active: true,
};

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function AdvertisementsAdminInner() {
  const [canEdit, setCanEdit] = useState(false);
  const [rows, setRows] = useState<AdRow[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = useCallback(async () => {
    setError(null);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageMarketing(session?.role ?? null));
    const http = await adminFetch("/api/admin/advertisements?limit=120");
    const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
    if (!http.ok || res.ok === false) {
      setError(String(res.error ?? "Chargement impossible"));
      return;
    }
    setRows((res.advertisements as AdRow[]) ?? []);
    setCategories((res.categories as string[]) ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    let impressions = 0;
    let clicks = 0;
    for (const row of rows) {
      impressions += row.analytics?.impressions ?? 0;
      clicks += row.analytics?.clicks ?? 0;
    }
    const ctr = impressions > 0 ? ((clicks / impressions) * 100).toFixed(2) : "0.00";
    return { impressions, clicks, ctr };
  }, [rows]);

  const editRow = (row: AdRow) => {
    setForm({
      id: row.id,
      title: row.title ?? "",
      subtitle: row.subtitle ?? "",
      image_url: row.image_url ?? "",
      button_text: row.button_text ?? "",
      button_action: row.button_action ?? "",
      placement: row.placement ?? "client_home",
      category: row.category ?? "Campagnes MMD",
      country: row.country ?? "",
      city: row.city ?? "",
      language: row.language ?? "",
      audience: row.audience ?? "",
      priority: String(row.priority ?? 0),
      display_order: String(row.display_order ?? 0),
      start_date: toLocalInput(row.start_date),
      end_date: toLocalInput(row.end_date),
      is_active: Boolean(row.is_active),
    });
    setNotice(null);
  };

  const onUpload = async (file: File | null) => {
    if (!file || !canEdit) return;
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const http = await adminFetch("/api/admin/advertisements", {
        method: "POST",
        body,
      });
      const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
      if (!http.ok || res.ok === false) {
        setError(String(res.error ?? "Upload impossible"));
        return;
      }
      setForm((prev) => ({ ...prev, image_url: String(res.image_url ?? "") }));
      setNotice("Image téléversée.");
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const http = await adminFetch("/api/admin/advertisements", {
        method: "POST",
        body: JSON.stringify({
          action: "upsert",
          id: form.id || undefined,
          title: form.title,
          subtitle: form.subtitle || null,
          image_url: form.image_url,
          button_text: form.button_text || null,
          button_action: form.button_action || null,
          placement: form.placement || "client_home",
          category: form.category,
          country: form.country || null,
          city: form.city || null,
          language: form.language || null,
          audience: form.audience || null,
          priority: Number(form.priority) || 0,
          display_order: Number(form.display_order) || 0,
          start_date: form.start_date || null,
          end_date: form.end_date || null,
          is_active: form.is_active,
        }),
      });
      const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
      if (!http.ok || res.ok === false) {
        setError(String(res.error ?? "Enregistrement impossible"));
        return;
      }
      setNotice(form.id ? "Publicité mise à jour." : "Publicité créée.");
      setForm(EMPTY_FORM);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!canEdit) return;
    if (!window.confirm("Supprimer cette publicité ?")) return;
    const http = await adminFetch("/api/admin/advertisements", {
      method: "POST",
      body: JSON.stringify({ action: "delete", id }),
    });
    const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
    if (!http.ok || res.ok === false) {
      setError(String(res.error ?? "Suppression impossible"));
      return;
    }
    if (form.id === id) setForm(EMPTY_FORM);
    setNotice("Publicité supprimée.");
    await load();
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Publicités Home Client</h1>
        <p className="mt-1 text-sm text-slate-600">
          CMS dynamique — aucune image dans l&apos;app. Modifications visibles sans rebuild.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className={CARD}>
          <div className={LABEL}>Impressions</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{totals.impressions}</div>
        </div>
        <div className={CARD}>
          <div className={LABEL}>Clics</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{totals.clicks}</div>
        </div>
        <div className={CARD}>
          <div className={LABEL}>CTR global</div>
          <div className="mt-1 text-2xl font-bold text-emerald-600">{totals.ctr}%</div>
        </div>
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

      <form onSubmit={onSubmit} className={`${CARD} space-y-4`}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">
            {form.id ? "Modifier la publicité" : "Nouvelle publicité"}
          </h2>
          {form.id ? (
            <button
              type="button"
              className="text-sm font-semibold text-slate-500 hover:text-slate-800"
              onClick={() => setForm(EMPTY_FORM)}
            >
              Nouvelle
            </button>
          ) : null}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className={LABEL}>Titre</span>
            <input
              className={INPUT}
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              required
              disabled={!canEdit}
            />
          </label>
          <label className="block">
            <span className={LABEL}>Sous-titre</span>
            <input
              className={INPUT}
              value={form.subtitle}
              onChange={(e) => setForm((p) => ({ ...p, subtitle: e.target.value }))}
              disabled={!canEdit}
            />
          </label>
          <label className="block md:col-span-2">
            <span className={LABEL}>Image URL (Storage)</span>
            <input
              className={INPUT}
              value={form.image_url}
              onChange={(e) => setForm((p) => ({ ...p, image_url: e.target.value }))}
              required
              disabled={!canEdit}
            />
          </label>
          <label className="block md:col-span-2">
            <span className={LABEL}>Remplacer l&apos;image</span>
            <input
              className="mt-1 block w-full text-sm"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              disabled={!canEdit || uploading}
              onChange={(e) => void onUpload(e.target.files?.[0] ?? null)}
            />
          </label>
          {form.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={form.image_url}
              alt=""
              className="h-36 w-full rounded-xl object-cover md:col-span-2"
            />
          ) : null}
          <label className="block">
            <span className={LABEL}>Texte bouton</span>
            <input
              className={INPUT}
              value={form.button_text}
              onChange={(e) => setForm((p) => ({ ...p, button_text: e.target.value }))}
              disabled={!canEdit}
            />
          </label>
          <label className="block">
            <span className={LABEL}>Action / lien</span>
            <input
              className={INPUT}
              value={form.button_action}
              onChange={(e) => setForm((p) => ({ ...p, button_action: e.target.value }))}
              placeholder="taxi | food | delivery | marketplace | rewards | https://..."
              disabled={!canEdit}
            />
          </label>
          <label className="block">
            <span className={LABEL}>Catégorie</span>
            <select
              className={INPUT}
              value={form.category}
              onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
              disabled={!canEdit}
            >
              {(categories.length ? categories : ["Campagnes MMD"]).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={LABEL}>Placement</span>
            <select
              className={INPUT}
              value={form.placement}
              onChange={(e) => setForm((p) => ({ ...p, placement: e.target.value }))}
              disabled={!canEdit}
            >
              <option value="client_home">client_home (Home Client carousel)</option>
              <option value="restaurant_sidebar">restaurant_sidebar (Restaurant sidebar)</option>
            </select>
          </label>
          <label className="block">
            <span className={LABEL}>Pays</span>
            <input
              className={INPUT}
              value={form.country}
              onChange={(e) => setForm((p) => ({ ...p, country: e.target.value }))}
              disabled={!canEdit}
            />
          </label>
          <label className="block">
            <span className={LABEL}>Ville</span>
            <input
              className={INPUT}
              value={form.city}
              onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))}
              disabled={!canEdit}
            />
          </label>
          <label className="block">
            <span className={LABEL}>Langue</span>
            <input
              className={INPUT}
              value={form.language}
              onChange={(e) => setForm((p) => ({ ...p, language: e.target.value }))}
              disabled={!canEdit}
            />
          </label>
          <label className="block">
            <span className={LABEL}>Audience</span>
            <select
              className={INPUT}
              value={form.audience}
              onChange={(e) => setForm((p) => ({ ...p, audience: e.target.value }))}
              disabled={!canEdit}
            >
              <option value="">Toutes / non ciblée</option>
              <option value="client">client</option>
              <option value="restaurant">restaurant</option>
              <option value="driver">driver</option>
            </select>
          </label>
          <label className="block">
            <span className={LABEL}>Priorité</span>
            <input
              className={INPUT}
              type="number"
              value={form.priority}
              onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}
              disabled={!canEdit}
            />
          </label>
          <label className="block">
            <span className={LABEL}>Ordre d&apos;affichage</span>
            <input
              className={INPUT}
              type="number"
              value={form.display_order}
              onChange={(e) => setForm((p) => ({ ...p, display_order: e.target.value }))}
              disabled={!canEdit}
            />
          </label>
          <label className="block">
            <span className={LABEL}>Début</span>
            <input
              className={INPUT}
              type="datetime-local"
              value={form.start_date}
              onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))}
              disabled={!canEdit}
            />
          </label>
          <label className="block">
            <span className={LABEL}>Fin</span>
            <input
              className={INPUT}
              type="datetime-local"
              value={form.end_date}
              onChange={(e) => setForm((p) => ({ ...p, end_date: e.target.value }))}
              disabled={!canEdit}
            />
          </label>
          <label className="flex items-center gap-2 pt-6 text-sm font-medium text-slate-800">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))}
              disabled={!canEdit}
            />
            Actif
          </label>
        </div>

        <button
          type="submit"
          disabled={!canEdit || saving}
          className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? "Enregistrement…" : form.id ? "Mettre à jour" : "Créer"}
        </button>
      </form>

      <div className={`${CARD} space-y-3`}>
        <h2 className="text-lg font-semibold text-slate-900">Publicités ({rows.length})</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune publicité pour le moment.</p>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <div
                key={row.id}
                className="flex flex-col gap-3 rounded-xl border border-slate-200 p-3 sm:flex-row sm:items-center"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={row.image_url}
                  alt=""
                  className="h-20 w-28 rounded-lg object-cover bg-slate-100"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-900">{row.title}</div>
                  <div className="text-sm text-slate-500">
                    {row.category} · {row.is_active ? "Actif" : "Inactif"} · ordre{" "}
                    {row.display_order}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {row.analytics?.impressions ?? 0} impressions · {row.analytics?.clicks ?? 0}{" "}
                    clics · CTR {row.analytics?.ctr ?? 0}%
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold"
                    onClick={() => editRow(row)}
                  >
                    Éditer
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-semibold text-red-600"
                    disabled={!canEdit}
                    onClick={() => void onDelete(row.id)}
                  >
                    Supprimer
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdvertisementsAdminPage() {
  return (
    <AdminGate requiredPermission="marketing.read">
      <AdvertisementsAdminInner />
    </AdminGate>
  );
}
