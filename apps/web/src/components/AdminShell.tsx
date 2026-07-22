"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/admin", label: "Hub" },
  { href: "/admin/sellers", label: "Sellers" },
  { href: "/admin/marketplace-orders", label: "Marketplace" },
  { href: "/admin/drivers", label: "Drivers" },
  { href: "/admin/payouts", label: "Payouts" },
  { href: "/admin/commission-engine", label: "Commissions" },
  { href: "/admin/subscriptions", label: "Abonnements" },
  { href: "/admin/mmd-plus", label: "MMD+" },
  { href: "/admin/marketing", label: "Marketing" },
  { href: "/admin/advertisements", label: "Publicités" },
  { href: "/admin/analytics", label: "Analytics" },
  { href: "/admin/finance", label: "Finance" },
  { href: "/admin/test-records", label: "Test Records" },
] as const;

export default function AdminShell({
  title,
  subtitle,
  children,
  actions,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">
              MMD Admin
            </p>
            {title ? <h1 className="text-xl font-semibold text-slate-900">{title}</h1> : null}
            {subtitle ? <p className="text-sm text-slate-600">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
        <nav
          className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-3"
          aria-label="Admin sections"
        >
          {NAV.map((item) => {
            const active =
              item.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap",
                  active
                    ? "bg-violet-100 text-violet-900"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                ].join(" ")}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
