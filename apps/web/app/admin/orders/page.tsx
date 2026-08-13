"use client";

import { Suspense } from "react";
import AdminGate from "@/components/AdminGate";
import AdminFoodOrdersManager from "@/components/admin/foodOrders/AdminFoodOrdersManager";
import FoodOrderCardSkeleton from "@/components/admin/foodOrders/FoodOrderCardSkeleton";

function OrdersFallback() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-48 animate-pulse rounded bg-slate-200" />
      <div className="h-40 animate-pulse rounded-2xl bg-white shadow-sm" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <FoodOrderCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

export default function AdminOrdersPage() {
  return (
    <AdminGate requiredPermission="orders.read">
      <main className="min-w-0">
        <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
          <Suspense fallback={<OrdersFallback />}>
            <AdminFoodOrdersManager />
          </Suspense>
        </div>
      </main>
    </AdminGate>
  );
}
