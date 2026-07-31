"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import Button from "@/components/Button";

type AccountRow = {
  member_id: string;
  role: string;
  account: { id: string; name: string; slug: string } | null;
  policy: Record<string, unknown> | null;
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

export default function BusinessOverviewPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);

  const refresh = useCallback(async () => {
    setError(null);
    const { data } = await supabase.auth.getSession();
    if (!data.session?.user) {
      router.replace("/login");
      return;
    }
    const out = await api("/api/taxi/business/accounts");
    setAccounts((out.accounts ?? []) as AccountRow[]);
  }, [router]);

  useEffect(() => {
    void refresh()
      .catch((e) => setError(e instanceof Error ? e.message : "load_failed"))
      .finally(() => setLoading(false));
  }, [refresh]);

  if (loading) {
    return <p className="text-slate-400">Loading business accounts…</p>;
  }

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">Business portal</h1>
      <p className="mt-2 text-slate-400">
        Manage corporate accounts, team members, and ride approvals.
      </p>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">
          {error}
        </div>
      ) : null}

      {accounts.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-slate-700 bg-slate-900/60 p-6 text-slate-400">
          No business membership found for this account.
        </div>
      ) : (
        <ul className="mt-8 space-y-4">
          {accounts.map((row) => (
            <li
              key={row.member_id}
              className="rounded-2xl border border-slate-700 bg-slate-900/60 p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold">
                    {row.account?.name ?? "Business account"}
                  </h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Role: {row.role} · {row.account?.slug}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href="/taxi/business/wallet">
                    <Button variant="secondary">Wallet</Button>
                  </Link>
                  {["manager", "admin"].includes(row.role) ? (
                    <>
                      <Link href="/business/members">
                        <Button variant="secondary">Members</Button>
                      </Link>
                      <Link href="/business/approvals">
                        <Button>Approvals</Button>
                      </Link>
                    </>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
