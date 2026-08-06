"use client";

export default function TaxiRideCardSkeleton() {
  return (
    <div
      className="animate-pulse rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      aria-hidden
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="h-5 w-28 rounded bg-slate-200" />
          <div className="h-3 w-40 rounded bg-slate-100" />
        </div>
        <div className="h-6 w-16 rounded bg-slate-200" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="flex gap-2">
          <div className="h-10 w-10 rounded-full bg-slate-200" />
          <div className="space-y-1.5">
            <div className="h-3 w-24 rounded bg-slate-200" />
            <div className="h-3 w-16 rounded bg-slate-100" />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="h-10 w-10 rounded-full bg-slate-200" />
          <div className="space-y-1.5">
            <div className="h-3 w-24 rounded bg-slate-200" />
            <div className="h-3 w-16 rounded bg-slate-100" />
          </div>
        </div>
      </div>
      <div className="mt-4 h-16 rounded-xl bg-slate-100" />
      <div className="mt-3 h-8 rounded-lg bg-slate-100" />
    </div>
  );
}
