"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import { businessApi } from "@/components/business/businessApi";
import {
  BusinessEmptyCard,
  BusinessErrorBanner,
  BusinessLoadingState,
} from "@/components/business/BusinessShell";
import { bizCard, bizGlass } from "@/components/business/businessUi";

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

const AVATAR_COLORS = ["#22C55E", "#3B82F6", "#A855F7", "#F59E0B", "#06B6D4"];

function rolePillClass(role: string) {
  if (role === "admin") return "bg-[#FBBF24] text-[#0033CC]";
  return "border border-white/[0.12] bg-white/[0.12] text-white";
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
  const [showInvite, setShowInvite] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    const { data } = await supabase.auth.getSession();
    if (!data.session?.user) {
      router.replace("/login");
      return;
    }
    const out = await businessApi("/api/taxi/business/members");
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
      const out = await businessApi("/api/taxi/business/members/invite", {
        method: "POST",
        body: JSON.stringify({
          email,
          role,
          business_account_id: accountId,
        }),
      });
      setEmail("");
      setShowInvite(false);
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
      await businessApi("/api/taxi/business/members/update", {
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
    return (
      <BusinessLoadingState title="Loading members..." subtitle="Please wait" />
    );
  }

  if (!accountId && members.length === 0 && !error) {
    return (
      <BusinessEmptyCard
        title="No team yet"
        description="You need an active business membership to manage colleagues."
        actionLabel="Back to Dashboard"
        href="/business"
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-white">Team Members</h1>
          <p className="mt-1.5 text-base text-white/70">
            Invite colleagues and manage roles.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowInvite((v) => !v)}
          className="inline-flex items-center gap-2 rounded-[14px] bg-[#22C55E] px-6 py-3 text-sm font-bold text-[#0033CC] shadow-[0px_10px_12px_rgba(0,0,0,0.15)]"
        >
          <span aria-hidden>+</span> Invite Member
        </button>
      </div>

      {error ? <BusinessErrorBanner message={error} /> : null}
      {message ? (
        <div className="rounded-2xl border border-emerald-400/40 bg-emerald-500/15 p-4 text-emerald-100">
          {message}
        </div>
      ) : null}

      {showInvite ? (
        <form
          onSubmit={onInvite}
          className={`${bizCard} grid gap-3 p-5 md:grid-cols-[1fr_160px_auto]`}
        >
          <input
            className="rounded-xl border border-white/20 bg-white/[0.06] px-3 py-2.5 text-white placeholder:text-white/40"
            type="email"
            required
            placeholder="colleague@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select
            className="rounded-xl border border-white/20 bg-[#0033CC] px-3 py-2.5 text-white"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="employee">Employee</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-[#22C55E] px-5 py-2.5 text-sm font-extrabold text-white disabled:opacity-60"
          >
            {busy ? "Sending…" : "Send invite"}
          </button>
        </form>
      ) : null}

      {invites.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="inline-flex w-fit items-center gap-2 rounded-full bg-[#FBBF24] px-3 py-2 text-[13px] font-bold text-[#0033CC]">
            Pending Invites
          </div>
          {invites.map((inv) => (
            <div
              key={inv.id}
              className={`${bizGlass} flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3.5`}
            >
              <div>
                <p className="text-sm font-bold text-white">{inv.email}</p>
                <p className="text-[13px] text-white/70">
                  {inv.role} · {inv.status || "pending"}
                </p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.06] px-2.5 py-1.5 text-xs font-bold text-[#FBBF24]">
                <span className="size-2 rounded-sm bg-[#FBBF24]" />
                Pending
              </span>
            </div>
          ))}
        </section>
      ) : null}

      <section className={`${bizCard} overflow-hidden`}>
        <div className="hidden gap-4 border-b border-white/[0.06] bg-white/[0.06] px-4 py-3 text-[13px] font-semibold text-white/70 md:grid md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_140px_120px_auto]">
          <span>Name</span>
          <span>Email</span>
          <span>Role</span>
          <span>Status</span>
          <span>Actions</span>
        </div>
        {members.length === 0 ? (
          <p className="p-6 text-sm text-white/60">No members yet.</p>
        ) : (
          <ul>
            {members.map((m, idx) => {
              const label = m.full_name || m.email || m.user_id.slice(0, 8);
              return (
                <li
                  key={m.id}
                  className="grid gap-3 border-b border-white/[0.06] p-4 last:border-b-0 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_140px_120px_auto] md:items-center"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="flex size-10 items-center justify-center rounded-full text-sm font-bold text-white"
                      style={{
                        backgroundColor: AVATAR_COLORS[idx % AVATAR_COLORS.length],
                      }}
                    >
                      {label.slice(0, 1).toUpperCase()}
                    </div>
                    <p className="truncate text-[15px] font-semibold text-white">
                      {label}
                    </p>
                  </div>
                  <p className="truncate text-sm text-white/70">
                    {m.email ?? "—"}
                  </p>
                  <div>
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1.5 text-xs font-bold capitalize ${rolePillClass(m.role)}`}
                    >
                      {m.role}
                    </span>
                  </div>
                  <div>
                    <span
                      className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1.5 text-xs font-bold ${
                        m.active
                          ? "bg-[#22C55E] text-[#0033CC]"
                          : "bg-[#FBBF24] text-[#0033CC]"
                      }`}
                    >
                      <span className="size-2 rounded-sm bg-white" />
                      {m.active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="rounded-lg border border-white/20 bg-[#0033CC] px-2 py-1.5 text-sm text-white"
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
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void updateMember(m.id, { active: !m.active })
                      }
                      className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
                    >
                      {m.active ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
