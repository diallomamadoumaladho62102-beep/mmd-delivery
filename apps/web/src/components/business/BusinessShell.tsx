"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SocialLinks } from "@/components/site/SocialLinks";
import { getActiveSocialLinks } from "@mmd/social-links";
import {
  BIZ_LOGO,
  bizGlass,
  bizNavActive,
  bizNavIdle,
  bizShell,
} from "./businessUi";

const FOOTER_SOCIAL = getActiveSocialLinks().filter((link) =>
  ["instagram", "x", "linkedin"].includes(link.id)
);

export const BUSINESS_NAV = [
  { href: "/business", label: "Dashboard", match: "exact" as const },
  { href: "/business/members", label: "Members", match: "prefix" as const },
  { href: "/business/wallet", label: "Wallet", match: "prefix" as const },
  { href: "/business/approvals", label: "Approvals", match: "prefix" as const },
] as const;

type Props = {
  children: ReactNode;
  /** Optional initials for avatar (from real session). */
  avatarInitials?: string | null;
};

function isActive(pathname: string, href: string, match: "exact" | "prefix") {
  if (match === "exact") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BusinessShell({ children, avatarInitials }: Props) {
  const pathname = usePathname();
  const initials = (avatarInitials || "MM").slice(0, 2).toUpperCase();

  return (
    <div className={bizShell}>
      <header
        className={`${bizGlass} mx-auto mt-0 flex h-[72px] w-full max-w-[1280px] items-center justify-between rounded-[20px] px-4 py-4 sm:h-[88px] sm:px-8`}
      >
        <Link href="/business" className="flex items-center gap-3">
          <Image
            src={BIZ_LOGO}
            alt="MMD Delivery"
            width={40}
            height={40}
            className="size-10 rounded-xl object-contain"
            priority
          />
          <span className="text-lg font-extrabold text-[#D4AF37] sm:text-[18px]">
            MMD Business
          </span>
        </Link>

        <div className="flex items-center gap-2 sm:gap-4">
          <nav className="hidden items-center gap-2 md:flex lg:gap-2.5">
            {BUSINESS_NAV.map((item) => {
              const active = isActive(pathname, item.href, item.match);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={active ? bizNavActive : bizNavIdle}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div
            className="flex size-10 items-center justify-center rounded-xl border border-white/[0.12] bg-white/[0.08] text-sm font-bold"
            aria-label="Account"
          >
            {initials}
          </div>
        </div>
      </header>

      <nav className="mx-auto flex w-full max-w-[1280px] gap-2 overflow-x-auto px-4 py-3 md:hidden">
        {BUSINESS_NAV.map((item) => {
          const active = isActive(pathname, item.href, item.match);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`whitespace-nowrap ${active ? bizNavActive : bizNavIdle}`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <main className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col px-4 py-6 sm:px-8 sm:py-8">
        {children}
      </main>

      <footer
        className={`${bizGlass} mx-auto mb-0 flex h-[72px] w-full max-w-[1280px] items-center justify-between rounded-[20px] px-4 py-4 sm:px-8`}
      >
        <p className="text-xs text-white/70 sm:text-[13px]">Follow MMD Delivery</p>
        <SocialLinks
          variant="icons"
          showLabels={false}
          links={FOOTER_SOCIAL.length ? FOOTER_SOCIAL : undefined}
          className="gap-2.5 [&_a]:h-9 [&_a]:w-9 [&_a]:rounded-[18px]"
        />
      </footer>
    </div>
  );
}

export function BusinessLoadingState({
  title = "Loading business accounts...",
  subtitle = "Please wait",
}: {
  title?: string;
  subtitle?: string;
}) {
  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <div
        className={`${bizGlass} flex w-full max-w-[520px] flex-col items-center gap-5 rounded-[32px] p-12 shadow-[0px_18px_40px_0px_rgba(0,0,0,0.15)]`}
      >
        <div
          className="size-[72px] animate-spin rounded-full border-4 border-white/20 border-t-[#D4AF37]"
          aria-hidden
        />
        <div className="w-full text-center">
          <p className="text-[22px] font-semibold text-white">{title}</p>
          <p className="mt-2 text-base text-white/60">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

export function BusinessEmptyCard({
  title,
  description,
  actionLabel,
  onAction,
  href,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  href?: string;
}) {
  const ctaClass =
    "inline-flex items-center justify-center rounded-2xl bg-[#22C55E] px-10 py-4 text-base font-extrabold text-white shadow-[0px_10px_12px_rgba(34,197,94,0.4)]";

  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <div
        className={`${bizGlass} flex w-full max-w-[720px] flex-col items-center gap-5 overflow-hidden rounded-[32px] p-12 text-center shadow-[0px_18px_40px_-12px_rgba(0,0,0,0.15)]`}
      >
        <div className="flex size-24 items-center justify-center rounded-[48px] border border-white/[0.12] bg-white/[0.08] text-4xl">
          🏢
        </div>
        <p className="text-[28px] font-bold text-white">{title}</p>
        <p className="max-w-xl text-base text-white/60">{description}</p>
        {href && actionLabel ? (
          <Link href={href} className={ctaClass}>
            {actionLabel}
          </Link>
        ) : null}
        {onAction && actionLabel && !href ? (
          <button type="button" onClick={onAction} className={ctaClass}>
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function BusinessErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-red-400/40 bg-red-500/15 p-4 text-red-100">
      {message}
    </div>
  );
}
