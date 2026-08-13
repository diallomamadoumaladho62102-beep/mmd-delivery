"use client";

import { Suspense } from "react";
import AdminDriversManager from "@/components/admin/drivers/AdminDriversManager";
import DriverCardSkeleton from "@/components/admin/drivers/DriverCardSkeleton";

function DriversFallback() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-56 animate-pulse rounded bg-slate-200" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-2xl bg-white shadow-sm" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <DriverCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

export default function AdminDriversPage() {
  return (
    <main className="min-w-0">
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        <Suspense fallback={<DriversFallback />}>
          <AdminDriversManager />
        </Suspense>
      </div>
    </main>
  );
}
