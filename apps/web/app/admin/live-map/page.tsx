"use client";

import AdminGate from "@/components/AdminGate";
import AdminOpsLiveMap from "@/components/admin/AdminOpsLiveMap";

export default function AdminLiveMapPage() {
  return (
    <AdminGate requiredPermission="supervision.read">
      <div className="mx-auto max-w-[1600px] space-y-4">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--cc-muted)]">
            Operations
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            Live Map
          </h1>
          <p className="mt-1 text-sm text-[var(--cc-muted)]">
            Supervisez en temps réel chauffeurs, clients, restaurants, commerces,
            commandes et courses taxi — avec itinéraires, ETA et suivi de mission.
          </p>
        </header>
        <AdminOpsLiveMap heightClass="h-[min(78vh,820px)]" showHeaderLink={false} />
      </div>
    </AdminGate>
  );
}
