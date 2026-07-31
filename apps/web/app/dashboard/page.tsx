"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";

type PortalLink = { href: string; label: string; description: string };

const PORTALS: PortalLink[] = [
  {
    href: "/client",
    label: "Client",
    description: "Orders, rides, packages, and wallet",
  },
  {
    href: "/orders/driver",
    label: "Driver",
    description: "Missions, earnings, and vehicle tools",
  },
  {
    href: "/restaurants",
    label: "Restaurant",
    description: "Orders, menu, and command center",
  },
  {
    href: "/business",
    label: "Business",
    description: "Team wallets, members, and approvals",
  },
  {
    href: "/account",
    label: "Account",
    description: "Profile and account settings",
  },
  {
    href: "/download",
    label: "Mobile app",
    description: "Download iOS or Android",
  },
];

/** Post-login hub with links to live product surfaces only. */
export default function DashboardHubPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.replace("/auth");
        return;
      }
      if (cancelled) return;

      setEmail(data.session.user.email ?? null);
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", data.session.user.id)
        .maybeSingle();
      if (cancelled) return;

      const nextRole = String(profile?.role ?? "").toLowerCase();
      setRole(nextRole || null);
      if (nextRole === "driver") router.replace("/orders/driver");
      else if (nextRole === "restaurant") router.replace("/restaurants");
      else if (nextRole === "admin" || nextRole === "staff")
        router.replace("/admin");
      else if (nextRole === "seller") router.replace("/seller");
      else if (nextRole === "client" || nextRole === "customer")
        router.replace("/client");
      else setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#040716] text-slate-300">
        Loading…
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#040716] px-4 py-12 text-white">
      <div className="mx-auto max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-orange-300">
          MMD Delivery
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Welcome</h1>
        <p className="mt-2 text-slate-400">
          {email ? `Signed in as ${email}` : "Signed in"}
          {role ? ` · role: ${role}` : ""}
        </p>
        <p className="mt-4 text-sm text-slate-400">
          Choose a workspace. The mobile apps provide the full experience for
          taxi, food, packages, marketplace, and business.
        </p>
        <ul className="mt-8 grid gap-3 sm:grid-cols-2">
          {PORTALS.map((portal) => (
            <li key={portal.href}>
              <Link
                href={portal.href}
                className="block rounded-2xl border border-white/10 bg-slate-900/70 p-5 transition hover:border-orange-400/40"
              >
                <span className="font-semibold text-white">{portal.label}</span>
                <span className="mt-1 block text-sm text-slate-400">
                  {portal.description}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
