"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageMarketing } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";
import { BLOCK_TYPES } from "@/lib/siteCms";

const CARD = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
const INPUT = "mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";
const LABEL = "text-xs font-semibold uppercase tracking-wide text-slate-500";

type PageMeta = {
  id: string;
  slug: string;
  title: string;
  kind: string;
  template: string;
  status: string;
  published_at: string | null;
  scheduled_for: string | null;
  seo: Record<string, unknown>;
};

type BlockRow = {
  id: string;
  block_type: string;
  sort_order: number;
  visible: boolean;
  status: string;
  payload: Record<string, unknown>;
};

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function PageEditorInner() {
  const params = useParams();
  const pageId = String(params?.id ?? "");
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState<PageMeta | null>(null);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [seoText, setSeoText] = useState("{}");
  const [newBlockType, setNewBlockType] = useState<string>(BLOCK_TYPES[0]);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [blockPayloadText, setBlockPayloadText] = useState("{}");

  const load = useCallback(async () => {
    if (!pageId) return;
    setError(null);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageMarketing(session?.role ?? null));
    const http = await adminFetch(`/api/admin/site/pages/${pageId}`);
    const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
    if (!http.ok || res.ok === false) {
      setError(String(res.error ?? "Load failed"));
      return;
    }
    const p = res.page as PageMeta;
    setPage(p);
    setSeoText(JSON.stringify(p.seo ?? {}, null, 2));
    setBlocks((res.blocks as BlockRow[]) ?? []);
  }, [pageId]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveMeta = async (e: FormEvent) => {
    e.preventDefault();
    if (!canEdit || !page) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      let seo: Record<string, unknown>;
      try {
        seo = JSON.parse(seoText) as Record<string, unknown>;
      } catch {
        setError("Invalid SEO JSON");
        return;
      }
      const http = await adminFetch(`/api/admin/site/pages/${pageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: page.slug,
          title: page.title,
          kind: page.kind,
          template: page.template,
          status: page.status,
          scheduled_for: page.scheduled_for || null,
          published_at: page.published_at || null,
          seo,
        }),
      });
      const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
      if (!http.ok || res.ok === false) {
        setError(String(res.error ?? "Save failed"));
        return;
      }
      setNotice("Page saved (revision created).");
      await load();
    } finally {
      setSaving(false);
    }
  };

  const reorder = async (ordered: BlockRow[]) => {
    setBlocks(ordered);
    if (!canEdit) return;
    const http = await adminFetch(`/api/admin/site/pages/${pageId}/blocks`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ordered_ids: ordered.map((b) => b.id) }),
    });
    const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
    if (!http.ok || res.ok === false) {
      setError(String(res.error ?? "Reorder failed"));
      await load();
      return;
    }
    setBlocks((res.blocks as BlockRow[]) ?? ordered);
    setNotice("Block order saved.");
  };

  const move = (index: number, dir: -1 | 1) => {
    const next = index + dir;
    if (next < 0 || next >= blocks.length) return;
    const copy = [...blocks];
    const tmp = copy[index];
    copy[index] = copy[next];
    copy[next] = tmp;
    void reorder(copy);
  };

  const addBlock = async () => {
    if (!canEdit) return;
    const http = await adminFetch(`/api/admin/site/pages/${pageId}/blocks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        block_type: newBlockType,
        payload: { title: newBlockType },
        status: "published",
      }),
    });
    const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
    if (!http.ok || res.ok === false) {
      setError(String(res.error ?? "Add block failed"));
      return;
    }
    setNotice("Block added.");
    await load();
  };

  const openBlockEdit = (block: BlockRow) => {
    setEditingBlockId(block.id);
    setBlockPayloadText(JSON.stringify(block.payload ?? {}, null, 2));
  };

  const saveBlock = async () => {
    if (!canEdit || !editingBlockId) return;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(blockPayloadText) as Record<string, unknown>;
    } catch {
      setError("Invalid block payload JSON");
      return;
    }
    const block = blocks.find((b) => b.id === editingBlockId);
    const http = await adminFetch(`/api/admin/site/blocks/${editingBlockId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payload,
        visible: block?.visible ?? true,
        status: block?.status ?? "published",
      }),
    });
    const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
    if (!http.ok || res.ok === false) {
      setError(String(res.error ?? "Block save failed"));
      return;
    }
    setNotice("Block updated.");
    setEditingBlockId(null);
    await load();
  };

  const deleteBlock = async (id: string) => {
    if (!canEdit || !window.confirm("Delete this block?")) return;
    const http = await adminFetch(`/api/admin/site/blocks/${id}`, {
      method: "DELETE",
    });
    const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
    if (!http.ok || res.ok === false) {
      setError(String(res.error ?? "Delete failed"));
      return;
    }
    setNotice("Block deleted.");
    await load();
  };

  const toggleVisible = async (block: BlockRow) => {
    if (!canEdit) return;
    const http = await adminFetch(`/api/admin/site/blocks/${block.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visible: !block.visible }),
    });
    const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
    if (!http.ok || res.ok === false) {
      setError(String(res.error ?? "Update failed"));
      return;
    }
    await load();
  };

  if (!page) {
    return (
      <div className="p-6 text-sm text-slate-600">
        {error ? error : "Loading…"}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <Link
          href="/admin/site/pages"
          className="text-sm font-semibold text-slate-500 hover:text-slate-800"
        >
          ← Pages
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Edit page</h1>
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

      <form onSubmit={saveMeta} className={`${CARD} space-y-4`}>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className={LABEL}>Title</span>
            <input
              className={INPUT}
              value={page.title}
              onChange={(e) => setPage({ ...page, title: e.target.value })}
              disabled={!canEdit}
              required
            />
          </label>
          <label className="block">
            <span className={LABEL}>Slug</span>
            <input
              className={INPUT}
              value={page.slug}
              onChange={(e) => setPage({ ...page, slug: e.target.value })}
              disabled={!canEdit}
              required
            />
          </label>
          <label className="block">
            <span className={LABEL}>Kind</span>
            <input
              className={INPUT}
              value={page.kind}
              onChange={(e) => setPage({ ...page, kind: e.target.value })}
              disabled={!canEdit}
            />
          </label>
          <label className="block">
            <span className={LABEL}>Template</span>
            <input
              className={INPUT}
              value={page.template}
              onChange={(e) => setPage({ ...page, template: e.target.value })}
              disabled={!canEdit}
            />
          </label>
          <label className="block">
            <span className={LABEL}>Status</span>
            <select
              className={INPUT}
              value={page.status}
              onChange={(e) => setPage({ ...page, status: e.target.value })}
              disabled={!canEdit}
            >
              <option value="draft">draft</option>
              <option value="scheduled">scheduled</option>
              <option value="published">published</option>
              <option value="archived">archived</option>
            </select>
          </label>
          <label className="block">
            <span className={LABEL}>Scheduled for</span>
            <input
              className={INPUT}
              type="datetime-local"
              value={toLocalInput(page.scheduled_for)}
              onChange={(e) =>
                setPage({
                  ...page,
                  scheduled_for: e.target.value
                    ? new Date(e.target.value).toISOString()
                    : null,
                })
              }
              disabled={!canEdit}
            />
          </label>
          <label className="block md:col-span-2">
            <span className={LABEL}>SEO JSON</span>
            <textarea
              className={`${INPUT} min-h-[120px] font-mono text-xs`}
              value={seoText}
              onChange={(e) => setSeoText(e.target.value)}
              disabled={!canEdit}
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={!canEdit || saving}
          className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save page meta"}
        </button>
      </form>

      <div className={`${CARD} space-y-4`}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-[180px] flex-1">
            <span className={LABEL}>Add block</span>
            <select
              className={INPUT}
              value={newBlockType}
              onChange={(e) => setNewBlockType(e.target.value)}
              disabled={!canEdit}
            >
              {BLOCK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => void addBlock()}
            className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
          >
            Add
          </button>
        </div>

        {blocks.length === 0 ? (
          <p className="text-sm text-slate-500">No blocks.</p>
        ) : (
          <div className="space-y-3">
            {blocks.map((block, index) => (
              <div
                key={block.id}
                className="rounded-xl border border-slate-200 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-900">
                      {block.block_type}
                    </div>
                    <div className="text-xs text-slate-500">
                      order {block.sort_order} · {block.status} ·{" "}
                      {block.visible ? "visible" : "hidden"}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!canEdit || index === 0}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold disabled:opacity-40"
                      onClick={() => move(index, -1)}
                    >
                      Move up
                    </button>
                    <button
                      type="button"
                      disabled={!canEdit || index === blocks.length - 1}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold disabled:opacity-40"
                      onClick={() => move(index, 1)}
                    >
                      Move down
                    </button>
                    <button
                      type="button"
                      disabled={!canEdit}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold"
                      onClick={() => void toggleVisible(block)}
                    >
                      {block.visible ? "Hide" : "Show"}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold"
                      onClick={() => openBlockEdit(block)}
                    >
                      Edit payload
                    </button>
                    <button
                      type="button"
                      disabled={!canEdit}
                      className="rounded-lg border border-red-200 px-2 py-1 text-xs font-semibold text-red-600"
                      onClick={() => void deleteBlock(block.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {editingBlockId === block.id ? (
                  <div className="mt-3 space-y-2">
                    <textarea
                      className={`${INPUT} min-h-[180px] font-mono text-xs`}
                      value={blockPayloadText}
                      onChange={(e) => setBlockPayloadText(e.target.value)}
                      disabled={!canEdit}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={() => void saveBlock()}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        Save payload
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingBlockId(null)}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SitePageEditorPage() {
  return (
    <AdminGate requiredPermission="marketing.read">
      <PageEditorInner />
    </AdminGate>
  );
}
