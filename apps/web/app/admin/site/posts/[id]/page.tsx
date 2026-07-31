"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageMarketing } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

const CARD = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
const INPUT = "mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";
const LABEL = "text-xs font-semibold uppercase tracking-wide text-slate-500";

type Post = {
  id: string;
  post_type: string;
  slug: string;
  title: string;
  excerpt: string | null;
  body_md: string;
  author_name: string | null;
  categories: string[];
  tags: string[];
  status: string;
  published_at: string | null;
  scheduled_for: string | null;
  seo: Record<string, unknown>;
};

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function PostEditorInner() {
  const params = useParams();
  const id = String(params?.id ?? "");
  const [canEdit, setCanEdit] = useState(false);
  const [post, setPost] = useState<Post | null>(null);
  const [seoText, setSeoText] = useState("{}");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageMarketing(session?.role ?? null));
    const http = await adminFetch(`/api/admin/site/posts/${id}`);
    const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
    if (!http.ok || res.ok === false) {
      setError(String(res.error ?? "Load failed"));
      return;
    }
    const p = res.post as Post;
    setPost(p);
    setSeoText(JSON.stringify(p.seo ?? {}, null, 2));
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!canEdit || !post) return;
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
      const http = await adminFetch(`/api/admin/site/posts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...post,
          seo,
          categories: post.categories ?? [],
          tags: post.tags ?? [],
        }),
      });
      const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
      if (!http.ok || res.ok === false) {
        setError(String(res.error ?? "Save failed"));
        return;
      }
      setNotice("Post saved.");
      await load();
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!canEdit || !window.confirm("Delete this post?")) return;
    const http = await adminFetch(`/api/admin/site/posts/${id}`, { method: "DELETE" });
    const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
    if (!http.ok || res.ok === false) {
      setError(String(res.error ?? "Delete failed"));
      return;
    }
    window.location.href = "/admin/site/posts";
  };

  if (!post) {
    return <div className="p-6 text-sm text-slate-600">{error ?? "Loading…"}</div>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <Link href="/admin/site/posts" className="text-sm font-semibold text-slate-500 hover:text-slate-800">
          ← Posts
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Edit post</h1>
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

      <form onSubmit={save} className={`${CARD} space-y-4`}>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className={LABEL}>Title</span>
            <input
              className={INPUT}
              value={post.title}
              onChange={(e) => setPost({ ...post, title: e.target.value })}
              disabled={!canEdit}
              required
            />
          </label>
          <label className="block">
            <span className={LABEL}>Slug</span>
            <input
              className={INPUT}
              value={post.slug}
              onChange={(e) => setPost({ ...post, slug: e.target.value })}
              disabled={!canEdit}
              required
            />
          </label>
          <label className="block">
            <span className={LABEL}>Type</span>
            <select
              className={INPUT}
              value={post.post_type}
              onChange={(e) => setPost({ ...post, post_type: e.target.value })}
              disabled={!canEdit}
            >
              <option value="blog">blog</option>
              <option value="news">news</option>
              <option value="press">press</option>
              <option value="careers">careers</option>
              <option value="announcement">announcement</option>
            </select>
          </label>
          <label className="block">
            <span className={LABEL}>Status</span>
            <select
              className={INPUT}
              value={post.status}
              onChange={(e) => setPost({ ...post, status: e.target.value })}
              disabled={!canEdit}
            >
              <option value="draft">draft</option>
              <option value="scheduled">scheduled</option>
              <option value="published">published</option>
              <option value="archived">archived</option>
            </select>
          </label>
          <label className="block">
            <span className={LABEL}>Author</span>
            <input
              className={INPUT}
              value={post.author_name ?? ""}
              onChange={(e) => setPost({ ...post, author_name: e.target.value })}
              disabled={!canEdit}
            />
          </label>
          <label className="block">
            <span className={LABEL}>Scheduled for</span>
            <input
              className={INPUT}
              type="datetime-local"
              value={toLocalInput(post.scheduled_for)}
              onChange={(e) =>
                setPost({
                  ...post,
                  scheduled_for: e.target.value
                    ? new Date(e.target.value).toISOString()
                    : null,
                })
              }
              disabled={!canEdit}
            />
          </label>
          <label className="block md:col-span-2">
            <span className={LABEL}>Excerpt</span>
            <textarea
              className={`${INPUT} min-h-[80px]`}
              value={post.excerpt ?? ""}
              onChange={(e) => setPost({ ...post, excerpt: e.target.value })}
              disabled={!canEdit}
            />
          </label>
          <label className="block md:col-span-2">
            <span className={LABEL}>Body (Markdown)</span>
            <textarea
              className={`${INPUT} min-h-[260px] font-mono text-xs`}
              value={post.body_md ?? ""}
              onChange={(e) => setPost({ ...post, body_md: e.target.value })}
              disabled={!canEdit}
            />
          </label>
          <label className="block">
            <span className={LABEL}>Categories (comma)</span>
            <input
              className={INPUT}
              value={(post.categories ?? []).join(", ")}
              onChange={(e) =>
                setPost({
                  ...post,
                  categories: e.target.value
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                })
              }
              disabled={!canEdit}
            />
          </label>
          <label className="block">
            <span className={LABEL}>Tags (comma)</span>
            <input
              className={INPUT}
              value={(post.tags ?? []).join(", ")}
              onChange={(e) =>
                setPost({
                  ...post,
                  tags: e.target.value
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                })
              }
              disabled={!canEdit}
            />
          </label>
          <label className="block md:col-span-2">
            <span className={LABEL}>SEO JSON</span>
            <textarea
              className={`${INPUT} min-h-[100px] font-mono text-xs`}
              value={seoText}
              onChange={(e) => setSeoText(e.target.value)}
              disabled={!canEdit}
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={!canEdit || saving}
            className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save post"}
          </button>
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => void onDelete()}
            className="rounded-xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-600"
          >
            Delete
          </button>
        </div>
      </form>
    </div>
  );
}

export default function SitePostEditorPage() {
  return (
    <AdminGate requiredPermission="marketing.read">
      <PostEditorInner />
    </AdminGate>
  );
}
