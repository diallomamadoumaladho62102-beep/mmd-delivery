"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type OrderEvent = {
  id: string;
  order_id: string;
  event_type: string;
  old_status: string | null;
  new_status: string | null;
  description: string | null;
  triggered_role: string | null;
  created_at: string;
};

export function OrderTimeline({ orderId }: { orderId: string }) {
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // 1. Charger l'historique au début
  useEffect(() => {
    let isMounted = true;

    async function loadEvents() {
      setLoading(true);
      const { data, error } = await supabase
        .from("order_events")
        .select(
          "id, order_id, event_type, old_status, new_status, description, triggered_role, created_at"
        )
        .eq("order_id", orderId)
        .order("created_at", { ascending: true });

      if (!isMounted) return;

      if (error) {
        console.error("Erreur chargement order_events:", error);
        setEvents([]);
      } else {
        setEvents(data as OrderEvent[]);
      }
      setLoading(false);
    }

    loadEvents();

    return () => {
      isMounted = false;
    };
  }, [orderId]);

  // 2. Abonnement Realtime pour A (historique) + B (notif live)
  useEffect(() => {
    const channel = supabase
      .channel(`order-events-${orderId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "order_events",
          filter: `order_id=eq.${orderId}`,
        },
        (payload) => {
          const newEvent = payload.new as OrderEvent;
          setEvents((prev) => [...prev, newEvent]);
        }
      )
      .subscribe((status) => {
        console.log("Order events realtime status:", status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orderId]);

  // ===============================
  // 🔹 DÉDOUBLONNAGE AUTOMATIQUE
  // ===============================
  const dedupedEvents: OrderEvent[] = [];
  const seen = new Set<string>();

  for (const ev of events) {
    const key = `${ev.event_type}-${ev.old_status ?? ""}-${ev.new_status ?? ""}-${ev.created_at}`;
    if (!seen.has(key)) {
      seen.add(key);
      dedupedEvents.push(ev);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-500">Chargement de l&apos;historique…</p>
      </div>
    );
  }

  if (!dedupedEvents.length) {
    return (
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-400">
          Aucun événement enregistré pour cette commande pour le moment.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Historique de la commande
      </h2>

      <ol className="mt-4 space-y-3">
        {dedupedEvents.map((ev) => (
          <li key={ev.id} className="flex gap-3">
            <div className="mt-1 h-2 w-2 rounded-full bg-emerald-600" />
            <div className="flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {formatEventTitle(ev.event_type, ev.old_status, ev.new_status)}
                </p>
                <span className="text-xs text-slate-400">
                  {new Date(ev.created_at).toLocaleString()}
                </span>
              </div>
              {ev.description && (
                <p className="text-sm text-slate-500">{ev.description}</p>
              )}
              {ev.triggered_role && (
                <p className="text-xs text-slate-400">
                  Rôle : {ev.triggered_role}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function formatEventTitle(
  eventType: string,
  oldStatus: string | null,
  newStatus: string | null
) {
  if (eventType === "status_changed") {
    return `Statut : ${oldStatus ?? "—"} → ${newStatus ?? "—"}`;
  }
  return eventType;
}
