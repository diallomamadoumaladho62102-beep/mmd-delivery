"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { ADMIN_LOGO, CC_BTN_SECONDARY } from "@/components/admin/adminUi";

export function AdminLoadingState({
  title = "Loading…",
  subtitle = "Please wait",
}: {
  title?: string;
  subtitle?: string;
}) {
  return (
    <div className="flex min-h-[360px] items-center justify-center py-12">
      <div className="flex w-full max-w-md flex-col items-center gap-5 rounded-[28px] border border-white/12 bg-white/[0.06] p-10 text-center shadow-[0_18px_40px_rgba(0,0,0,0.25)] backdrop-blur-[12px]">
        <Image
          src={ADMIN_LOGO}
          alt="MMD Delivery"
          width={48}
          height={48}
          className="size-12 rounded-[14px] object-contain"
        />
        <div
          className="size-14 animate-spin rounded-full border-4 border-white/20 border-t-[#FBBF24]"
          aria-hidden
        />
        <div>
          <p className="text-xl font-semibold text-white">{title}</p>
          <p className="mt-2 text-sm text-white/60">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

export function AdminEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-[280px] items-center justify-center py-10">
      <div className="flex w-full max-w-xl flex-col items-center gap-4 rounded-[28px] border border-white/12 bg-white/[0.06] p-10 text-center backdrop-blur-[12px]">
        <Image
          src={ADMIN_LOGO}
          alt="MMD Delivery"
          width={48}
          height={48}
          className="size-12 rounded-[14px] object-contain"
        />
        <p className="text-2xl font-bold text-white">{title}</p>
        {description ? (
          <p className="text-sm text-white/70">{description}</p>
        ) : null}
        {action}
      </div>
    </div>
  );
}

export function AdminErrorState({
  title = "Something went wrong",
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-red-400/40 bg-red-500/15 p-5 text-red-100">
      <p className="font-bold">{title}</p>
      {message ? <p className="mt-1 text-sm opacity-90">{message}</p> : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className={`mt-3 ${CC_BTN_SECONDARY}`}
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
