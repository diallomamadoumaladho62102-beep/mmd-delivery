"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageMarketing } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

const CARD = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
const INPUT = "mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";
const LABEL = "text-xs font-semibold uppercase tracking-wide text-slate-500";

type MediaRow = {
  id: string;
  folder: string;
  filename: string;
  alt: string | null;
  tags: string[];
  public_url: string;
  bytes: number | null;
  mime: string | null;
};

function MediaInner() {
  const [canEdit, setCanEdit] = useState(false);
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [folder, setFolder] = useState("");
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [uploadFolder, setUploadFolder] = useState("general");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageMarketing(session?.role ?? null));
    const params = new URLSearchParams();
    if (folder) params.set("folder", folder);
    if (q) params.set("q", q);
    if (tag) params.set("tag", tag);
    const http = await adminFetch(`/api/admin/site/media?${params.toString()}`);
    const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
    if (!http.ok || res.ok === false) {
      setError(String(res.error ?? "Load failed"));
      return;
    }
    setRows((res.media as MediaRow[]) ?? []);
  }, [folder, q, tag]);

  useEffect(() => {
    void load();
  }, [load]);

  const onUpload = async (file: File | null) => {
    if (!file || !canEdit) return;
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("folder", uploadFolder || "general");
      const http = await adminFetch("/api/admin/site/media", {
        method: "POST",
        body,
      });
      const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
      if (!http.ok || res.ok === false) {
        setError(String(res.error ?? "Upload failed"));
        return;
      }
      setNotice("Uploaded.");
      await load();
    } finally {
      setUploading(false);
    }
  };

  const onReplace = async (id: string, file: File | null) => {
    if (!file || !canEdit) return;
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const http = await adminFetch(`/api/admin/site/media/${id}/replace`, {
        method: "POST",
        body,
      });
      const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
      if (!http.ok || res.ok === false) {
        setError(String(res.error ?? "Replace failed"));
        return;
      }
      setNotice("File replaced.");
      await load();
    } finally {
      setUploading(false);
    }
  };

  const rename = async (row: MediaRow) => {
    if (!canEdit) return;
    const filename = window.prompt("Filename", row.filename)?.trim();
    if (!filename) return;
    const http = await adminFetch("/api/admin/site/media", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: row.id, filename }),
    });
    const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
    if (!http.ok || res.ok === false) {
      setError(String(res.error ?? "Rename failed"));
      return;
    }
    await load();
  };

  const onDelete = async (id: string) => {
    if (!canEdit || !window.confirm("Delete media?")) return;
    const http = await adminFetch(`/api/admin/site/media?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
    if (!http.ok || res.ok === false) {
      setError(String(res.error ?? "Delete failed"));
      return;
    }
    await load();
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <Link href="/admin/site" className="text-sm font-semibold text-slate-500 hover:text-slate-800">
          ← Corporate Website
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Media library</h1>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {notice}
        </div>
      ) : null}

      <div className={`${CARD} grid gap-3 md:grid-cols-4`}>
        <label className="block">
          <span className={LABEL}>Folder filter</span>
          <input className={INPUT} value={folder} onChange={(e) => setFolder(e.target.value)} />
        </label>
        <label className="block">
          <span className={LABEL}>Search</span>
          <input className={INPUT} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="block">
          <span className={LABEL}>Tag</span>
          <input className={INPUT} value={tag} onChange={(e) => setTag(e.target.value)} />
        </label>
        <div className="flex items-end">
          <button
            type="button"
            onClick={() => void load()}
            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold"
          >
            Refresh
          </button>
        </div>
      </div>

      {canEdit ? (
        <div className={`${CARD} space-y-3`}>
          <h2 className="font-semibold text-slate-900">Upload</h2>
          <label className="block max-w-xs">
            <span className={LABEL}>Folder</span>
            <input
              className={INPUT}
              value={uploadFolder}
              onChange={(e) => setUploadFolder(e.target.value)}
            />
          </label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={uploading}
            onChange={(e) => void onUpload(e.target.files?.[0] ?? null)}
          />
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <div key={row.id} className={CARD}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={row.public_url}
              alt={row.alt ?? ""}
              className="h-36 w-full rounded-xl object-cover bg-slate-100"
            />
            <div className="mt-2 text-sm font-semibold text-slate-900">{row.filename}</div>
            <div className="text-xs text-slate-500">
              {row.folder} · {row.mime ?? "image"}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold"
                onClick={() => void rename(row)}
                disabled={!canEdit}
              >
                Rename
              </button>
              <label className="cursor-pointer rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold">
                Replace
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={!canEdit || uploading}
                  onChange={(e) => void onReplace(row.id, e.target.files?.[0] ?? null)}
                />
              </label>
              <button
                type="button"
                className="rounded-lg border border-red-200 px-2 py-1 text-xs font-semibold text-red-600"
                disabled={!canEdit}
                onClick={() => void onDelete(row.id)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
      {rows.length === 0 ? <p className="text-sm text-slate-500">No media.</p> : null}
    </div>
  );
}

export default function SiteMediaPage() {
  return (
    <AdminGate requiredPermission="marketing.read">
      <MediaInner />
    </AdminGate>
  );
}
