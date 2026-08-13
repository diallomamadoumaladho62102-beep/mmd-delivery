"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import { businessApi } from "@/components/business/businessApi";
import {
  BusinessEmptyCard,
  BusinessErrorBanner,
  BusinessLoadingState,
} from "@/components/business/BusinessShell";
import { bizCard, money } from "@/components/business/businessUi";

type AccountRow = {
  member_id: string;
  role: string;
  account: { id: string; name: string; slug: string } | null;
  policy: Record<string, unknown> | null;
};

type ActivityItem = {
  id: string;
  title: string;
  subtitle: string;
  kind: "member" | "approval" | "wallet";
};

export default function BusinessOverviewPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [memberCount, setMemberCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [activity, setActivity] = useState<ActivityItem[]>([]);

  const refresh = useCallback(async () => {
    setError(null);
    const { data } = await supabase.auth.getSession();
    if (!data.session?.user) {
      router.replace("/login");
      return;
    }

    const out = await businessApi("/api/taxi/business/accounts");
    const rows = (out.accounts ?? []) as AccountRow[];
    setAccounts(rows);

    if (rows.length === 0) {
      setMemberCount(0);
      setPendingCount(0);
      setBalanceCents(null);
      setActivity([]);
      return;
    }

    const [membersOut, pendingOut, walletOut, historyOut] = await Promise.all([
      businessApi("/api/taxi/business/members").catch(() => ({ members: [] })),
      businessApi("/api/taxi/business/rides/pending").catch(() => ({ rides: [] })),
      businessApi("/api/taxi/business/wallet/summary").catch(() => null),
      businessApi("/api/taxi/business/wallet/history?limit=8").catch(() => ({
        items: [],
      })),
    ]);

    const members = (membersOut.members ?? []) as Array<{
      id: string;
      full_name: string | null;
      email: string | null;
      created_at: string;
      active: boolean;
    }>;
    const invites = (membersOut.invites ?? []) as Array<{
      id: string;
      email: string;
      created_at: string;
      role: string;
    }>;
    const rides = (pendingOut.rides ?? []) as Array<{
      id: string;
      client_name: string | null;
      total_cents: number | null;
      currency: string | null;
      created_at: string;
    }>;
    const hist = (historyOut.items ?? []) as Array<{
      id: string;
      entry_type: string;
      direction: string;
      amount_cents: number;
      currency: string;
      status: string;
      created_at: string;
    }>;

    setMemberCount(members.length);
    setPendingCount(rides.length);
    if (walletOut) {
      setBalanceCents(
        Number(
          walletOut.available_cents ?? walletOut.balance_cents ?? 0
        )
      );
      setCurrency(String(walletOut.currency ?? "USD"));
    }

    const nextActivity: ActivityItem[] = [];
    for (const inv of invites.slice(0, 3)) {
      nextActivity.push({
        id: `inv-${inv.id}`,
        title: "New member invited",
        subtitle: `${inv.email} · ${inv.role} · ${new Date(inv.created_at).toLocaleString()}`,
        kind: "member",
      });
    }
    for (const ride of rides.slice(0, 3)) {
      nextActivity.push({
        id: `ride-${ride.id}`,
        title: "Approval pending",
        subtitle: `${ride.client_name ?? "Team member"} · ${money(
          Number(ride.total_cents ?? 0),
          ride.currency ?? "USD"
        )}`,
        kind: "approval",
      });
    }
    for (const item of hist.slice(0, 3)) {
      nextActivity.push({
        id: `tx-${item.id}`,
        title: `${item.entry_type} · ${item.status}`,
        subtitle: `${new Date(item.created_at).toLocaleString()} · ${
          item.direction === "credit" ? "+" : "−"
        }${money(item.amount_cents, item.currency)}`,
        kind: "wallet",
      });
    }
    setActivity(nextActivity.slice(0, 6));
  }, [router]);

  useEffect(() => {
    void refresh()
      .catch((e) => setError(e instanceof Error ? e.message : "load_failed"))
      .finally(() => setLoading(false));
  }, [refresh]);

  const primaryAccount = accounts[0];
  const canManage = ["manager", "admin"].includes(primaryAccount?.role ?? "");

  const balanceLabel = useMemo(() => {
    if (balanceCents == null) return "—";
    return money(balanceCents, currency);
  }, [balanceCents, currency]);

  if (loading) {
    return <BusinessLoadingState />;
  }

  if (accounts.length === 0 && !error) {
    return (
      <BusinessEmptyCard
        title="Business Portal"
        description="Manage corporate accounts, team members, and approvals."
        actionLabel="Get Started"
        href="/contact"
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-[28px] font-bold text-white sm:text-[32px]">
          Business Portal
        </h1>
        <p className="text-base text-white/60 sm:text-lg">
          Manage corporate accounts, team members, and approvals.
        </p>
        {primaryAccount?.account?.name ? (
          <p className="text-sm text-white/70">
            {primaryAccount.account.name} · {primaryAccount.role}
          </p>
        ) : null}
      </div>

      {error ? <BusinessErrorBanner message={error} /> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className={`${bizCard} flex flex-col gap-2.5 p-6`}>
          <p className="text-4xl font-bold text-white">{memberCount}</p>
          <p className="text-sm text-white/70">Team Members</p>
        </div>
        <div className={`${bizCard} flex flex-col gap-2.5 p-6`}>
          <p className="text-4xl font-bold text-white">{pendingCount}</p>
          <p className="text-sm text-white/70">Pending Approvals</p>
        </div>
        <div className={`${bizCard} flex flex-col gap-2.5 p-6`}>
          <p className="text-4xl font-bold text-white">{balanceLabel}</p>
          <p className="text-sm text-white/70">Total Balance</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        <section className={`${bizCard} flex flex-col gap-4 p-6`}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-white">Recent Activity</h2>
            <Link
              href="/business/wallet"
              className="text-[13px] font-bold text-white/70 hover:text-white"
            >
              View all
            </Link>
          </div>
          {activity.length === 0 ? (
            <p className="text-sm text-white/60">No recent activity yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {activity.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-2xl border border-white/[0.12] bg-white/[0.05] p-3"
                >
                  <div className="flex size-8 items-center justify-center rounded-2xl border border-white/[0.12] bg-white/[0.08] text-xs">
                    {item.kind === "member"
                      ? "+"
                      : item.kind === "approval"
                        ? "✓"
                        : "$"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-white">
                      {item.title}
                    </p>
                    <p className="truncate text-xs text-white/60">
                      {item.subtitle}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className={`${bizCard} flex flex-col gap-4 p-6`}>
          <h2 className="text-lg font-bold text-white">Quick Actions</h2>
          <div className="flex flex-col gap-3">
            <QuickAction href="/business/members" label="Invite member" />
            <QuickAction href="/business/wallet" label="Fund wallet" />
            {canManage ? (
              <QuickAction href="/business/approvals" label="Review approvals" />
            ) : null}
            <QuickAction href="/business/members" label="Company settings" />
          </div>

          <ul className="mt-2 flex flex-col gap-3">
            {accounts.map((row) => (
              <li
                key={row.member_id}
                className="rounded-2xl border border-white/[0.12] bg-white/[0.05] p-4"
              >
                <p className="font-bold text-white">
                  {row.account?.name ?? "Business account"}
                </p>
                <p className="mt-1 text-sm text-white/60">
                  Role: {row.role}
                  {row.account?.slug ? ` · ${row.account.slug}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

function QuickAction({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-2xl border border-white/[0.12] bg-white/[0.08] p-3.5 text-sm font-bold text-white transition hover:bg-white/[0.12]"
    >
      <span className="flex size-9 items-center justify-center rounded-[18px] border border-white/[0.12] bg-white/[0.08]">
        →
      </span>
      <span>{label}</span>
    </Link>
  );
}
