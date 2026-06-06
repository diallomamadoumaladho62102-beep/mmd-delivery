"use client";

import AdminGate from "@/components/AdminGate";
import AdminPricingView from "./AdminPricingView";

export default function AdminPricingPage() {
  return (
    <AdminGate requiredPermission="pricing.read">
      <AdminPricingView />
    </AdminGate>
  );
}
