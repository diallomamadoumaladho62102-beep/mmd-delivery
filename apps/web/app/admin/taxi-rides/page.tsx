"use client";

import { Suspense } from "react";
import AdminGate from "@/components/AdminGate";
import AdminTaxiRidesManager from "@/components/admin/taxiRides/AdminTaxiRidesManager";
import TaxiRideCardSkeleton from "@/components/admin/taxiRides/TaxiRideCardSkeleton";

function TaxiRidesFallback() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-56 animate-pulse rounded bg-slate-200" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-2xl bg-white shadow-sm" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <TaxiRideCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

export default function AdminTaxiRidesPage() {
  return (
    <AdminGate requiredPermission="taxi_rides.read">
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
          <Suspense fallback={<TaxiRidesFallback />}>
            <AdminTaxiRidesManager />
          </Suspense>
        </div>
      </main>
    </AdminGate>
  );
}
