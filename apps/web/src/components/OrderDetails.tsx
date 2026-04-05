"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseBrowser";

import OrderStatusBadge from "@/components/OrderStatusBadge";
import CommissionBreakdown from "@/components/CommissionBreakdown";
import MembersList from "@/components/MembersList";
import JoinButton from "@/components/JoinButton";
import LeaveButton from "@/components/LeaveButton";
import RoleSwitch from "@/components/RoleSwitch";
import StatusTester from "@/components/StatusTester";
import OrderStatusTimeline from "@/components/OrderStatusTimeline";

import OrderQuickActions from "@/components/OrderQuickActions";
import OrderAddresses from "@/components/OrderAddresses";
import OrderPayment from "@/components/OrderPayment";

type Row = {
  id: string;
  status: string | null;
  subtotal: number | null;
  currency: string | null;
  created_at: string;
  updated_at: string;
};

function fmtMoney(n: number | null | undefined, ccy: string | null | undefined) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy || "USD" })
    .format(Number.isFinite(Number(n)) ? Number(n) : 0);
}

export default function OrderDetails({ orderId }: { orderId: string }) {
  const [row, setRow] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true); setErr(null);
      const { data, error } = await supabase
        .from("orders")
        .select("id,status,subtotal,currency,created_at,updated_at")
        .eq("id", orderId)
        .maybeSingle();
      if (error) throw error;
      setRow(data as Row | null);
    } catch (e:any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [orderId]);

  if (loading) return <main className="p-6">Chargement…</main>;
  if (err) return <main className="p-6 text-red-600">Erreur: {err}</main>;
  if (!row) return <main className="p-6">Commande introuvable.</main>;

  const shortId = row.id.slice(0,8);

  return (
    <main className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Commande #{shortId}</h1>
        <OrderStatusBadge orderId={row.id} />
        <div className="ml-auto flex gap-2">
          <Link href={`/orders/${row.id}/chat`} className="px-3 py-1.5 border rounded hover:bg-gray-50 text-sm">
            Ouvrir le chat
          </Link>
          <Link href="/orders" className="px-3 py-1.5 border rounded hover:bg-gray-50 text-sm">
            ← Retour à la liste
          </Link>
        </div>
      </div>

      {/* Résumé */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="border rounded-2xl p-4">
          <div className="text-xs text-gray-500">ID</div>
          <div className="font-mono">{row.id}</div>
        </div>
        <div className="border rounded-2xl p-4">
          <div className="text-xs text-gray-500">Statut</div>
          <div className="uppercase tracking-wide">{row.status}</div>
        </div>
        <div className="border rounded-2xl p-4">
          <div className="text-xs text-gray-500">Total</div>
          <div className="font-semibold">{fmtMoney(row.subtotal, row.currency)}</div>
        </div>
        <div className="border rounded-2xl p-4">
          <div className="text-xs text-gray-500">Créée</div>
          <div>{new Date(row.created_at).toLocaleString()}</div>
        </div>
      </div>

      {/* Actions rapides + Paiement + Adresses */}
      <div className="grid md:grid-cols-2 gap-6">
        <OrderQuickActions orderId={row.id} current={row.status} />
        <OrderPayment orderId={row.id} />
      </div>
      <OrderAddresses orderId={row.id} />

      {/* Grille details */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <MembersList orderId={row.id} />
          <OrderStatusTimeline orderId={row.id} />
        </div>
        <div className="space-y-4">
          <CommissionBreakdown orderId={row.id} />
          <StatusTester orderId={row.id} />
          <div className="flex flex-wrap items-center gap-3">
            <JoinButton orderId={row.id} />
            <LeaveButton orderId={row.id} />
            <RoleSwitch orderId={row.id} />
          </div>
        </div>
      </div>
    </main>
  );
}

