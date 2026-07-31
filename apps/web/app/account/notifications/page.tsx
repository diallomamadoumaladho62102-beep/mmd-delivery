"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import Button from "@/components/Button";

type InboxItem = {
  id: string;
  title: string | null;
  body: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
  archived_at: string | null;
};

async function api(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("login_required");
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(json.error ?? `HTTP ${res.status}`));
  return json;
}

export default function AccountNotificationsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    setError(null);
    const { data } = await supabase.auth.getSession();
    if (!data.session?.user) {
      router.replace("/login");
      return;
    }
    const out = await api("/api/notifications/inbox?limit=50");
    setItems((out.items ?? []) as InboxItem[]);
    setUnread(Number(out.unread_count ?? 0));
  }, [router]);

  useEffect(() => {
    void refresh()
      .catch((e) => setError(e instanceof Error ? e.message : "load_failed"))
      .finally(() => setLoading(false));
  }, [refresh]);

  async function act(id: string, action: "read" | "archive") {
    try {
      await api("/api/notifications/inbox", {
        method: "PATCH",
        body: JSON.stringify({ id, action }),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "update_failed");
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 text-slate-700">
        Loading notifications…
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">
        Notifications
      </h1>
      <p className="mt-2 text-slate-500">
        {unread > 0 ? `${unread} unread` : "You are up to date"}
      </p>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className="mt-8 text-slate-500">No notifications yet.</p>
      ) : (
        <ul className="mt-8 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
          {items.map((item) => {
            const unreadItem = !item.read_at;
            return (
              <li
                key={item.id}
                className={[
                  "flex flex-wrap items-start justify-between gap-3 px-4 py-4",
                  unreadItem ? "bg-violet-50/60" : "",
                ].join(" ")}
              >
                <div>
                  <p className="font-semibold text-slate-900">
                    {item.title || "Notification"}
                  </p>
                  {item.body ? (
                    <p className="mt-1 text-sm text-slate-600">{item.body}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-slate-400">
                    {new Date(item.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  {unreadItem ? (
                    <Button
                      variant="secondary"
                      onClick={() => void act(item.id, "read")}
                    >
                      Mark read
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    onClick={() => void act(item.id, "archive")}
                  >
                    Archive
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
