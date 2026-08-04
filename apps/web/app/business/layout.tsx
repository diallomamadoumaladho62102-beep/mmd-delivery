"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import SocialLinks from "@/components/site/SocialLinks";

const NAV = [
  { href: "/business", label: "Overview" },
  { href: "/taxi/business/wallet", label: "Wallet" },
  { href: "/business/members", label: "Members" },
  { href: "/business/approvals", label: "Approvals" },
] as const;

export default function BusinessLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-4">
          <Link href="/business" className="text-lg font-black tracking-tight text-amber-400">
            MMD Business
          </Link>
          <nav className="flex flex-wrap gap-1">
            {NAV.map((item) => {
              const active =
                item.href === "/business"
                  ? pathname === "/business"
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={[
                    "rounded-lg px-3 py-2 text-sm font-semibold transition",
                    active
                      ? "bg-amber-500/20 text-amber-300"
                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-100",
                  ].join(" ")}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-4 py-8">{children}</div>
      <footer className="border-t border-slate-800 px-4 py-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">Follow MMD Delivery</p>
          <SocialLinks variant="icons" showLabels={false} />
        </div>
      </footer>
    </div>
  );
}
