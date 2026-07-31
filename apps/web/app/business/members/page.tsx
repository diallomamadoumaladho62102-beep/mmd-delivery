"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import Button from "@/components/Button";

type Member = {
  id: string;
  user_id: string;
  role: string;
  active: boolean;
  created_at: string;
  full_name: string | null;
  email: string | null;
};

type Invite = {
  id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string;
  created_at: string;
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

export default function BusinessMembersPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("employee");

  const refresh = useCallback(async () => {
    setError(null);
    const { data } = await supabase.auth.getSession();
    if (!data.session?.user) {
      router.replace("/login");
      return;
    }
    const out = await api("/api/taxi/business/members");
    setAccountId(String(out.business_account_id ?? "") || null);
    setMembers((out.members ?? []) as Member[]);
    setInvites((out.invites ?? []) as Invite[]);
  }, [router]);

  useEffect(() => {
    void refresh()
      .catch((e) => setError(e instanceof Error ? e.message : "load_failed"))
      .finally(() => setLoading(false));
  }, [refresh]);

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const out = await api("/api/taxi/business/members/invite", {
        method: "POST",
        body: JSON.stringify({
          email,
          role,
          business_account_id: accountId,
        }),
      });
      setEmail("");
      const mode = String(out.mode ?? "ok");
      setMessage(
        mode === "invite_created"
          ? `Invite created for ${email}`
          : mode === "member_added"
            ? "Existing user added as member"
            : mode === "member_updated"
              ? "Member updated"
              : "Already a member"
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "invite_failed");
    } finally {
      setBusy(false);
    }
  }

  async function updateMember(
    memberId: string,
    patch: { role?: string; active?: boolean }
  ) {
    setBusy(true);
    setError(null);
    try {
      await api("/api/taxi/business/members/update", {
        method: "PATCH",
        body: JSON.stringify({
          member_id: memberId,
          business_account_id: accountId,
          ...patch,
        }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "update_failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="text-slate-400">Loading members…</p>;
  }

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">Team members</h1>
      <p className="mt-2 text-slate-400">
        Invite colleagues and manage roles for your business account.
      </p>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-emerald-200">
          {message}
        </div>
      ) : null}

      <form
        onSubmit={onInvite}
        className="mt-8 grid gap-3 rounded-2xl border border-slate-700 bg-slate-900/60 p-5 md:grid-cols-[1fr_160px_auto]"
      >
        <input
          className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2"
          type="email"
          required
          placeholder="colleague@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <select
          className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          <option value="employee">Employee</option>
          <option value="manager">Manager</option>
          <option value="admin">Admin</option>
        </select>
        <Button type="submit" loading={busy}>
          Invite
        </Button>
      </form>

      <section className="mt-10">
        <h2 className="text-xl font-bold">Members</h2>
        {members.length === 0 ? (
          <p className="mt-3 text-slate-400">No members yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-800 rounded-2xl border border-slate-700 bg-slate-900/60">
            {members.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <p className="font-semibold">
                    {m.full_name || m.email || m.user_id.slice(0, 8)}
                  </p>
                  <p className="text-sm text-slate-400">
                    {m.email ?? "—"} · {m.active ? "active" : "inactive"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="rounded-lg border border-slate-600 bg-slate-950 px-2 py-1.5 text-sm"
                    value={m.role}
                    disabled={busy}
                    onChange={(e) =>
                      void updateMember(m.id, { role: e.target.value })
                    }
                  >
                    <option value="employee">Employee</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                  <Button
                    variant={m.active ? "danger" : "secondary"}
                    disabled={busy}
                    onClick={() =>
                      void updateMember(m.id, { active: !m.active })
                    }
                  >
                    {m.active ? "Deactivate" : "Activate"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {invites.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-xl font-bold">Pending invites</h2>
          <ul className="mt-4 divide-y divide-slate-800 rounded-2xl border border-slate-700 bg-slate-900/60">
            {invites.map((inv) => (
              <li key={inv.id} className="px-4 py-3">
                <p className="font-semibold">{inv.email}</p>
                <p className="text-sm text-slate-400">
                  {inv.role} · expires {new Date(inv.expires_at).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
