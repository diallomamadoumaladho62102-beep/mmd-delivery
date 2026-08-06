"use client";

export default function DriverCardSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-hidden>
      <div className="flex gap-3">
        <div className="h-12 w-12 rounded-full bg-slate-200" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-40 rounded bg-slate-200" />
          <div className="h-3 w-56 rounded bg-slate-100" />
        </div>
      </div>
      <div className="mt-4 h-8 rounded bg-slate-100" />
      <div className="mt-3 h-2 rounded-full bg-slate-100" />
      <div className="mt-4 flex gap-2">
        <div className="h-11 w-24 rounded-xl bg-slate-200" />
        <div className="h-11 w-24 rounded-xl bg-slate-200" />
      </div>
    </div>
  );
}
