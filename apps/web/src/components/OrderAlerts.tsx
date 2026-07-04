"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { mmdAudio } from "@/lib/mmdAudio";

const IMPORTANT_STATUSES = new Set([
  "assigned",
  "accepted",
  "prepared",
  "ready",
  "dispatched",
  "delivered",
]);

const LS_ENABLED = "mmdAlertsEnabled";
const LS_VOLUME = "mmdAlertsVolume";

function statusToToastClass(status: string | null): string {
  switch (status) {
    case "assigned":
      return "border-blue-200 bg-blue-50 text-blue-800";
    case "accepted":
      return "border-sky-200 bg-sky-50 text-sky-800";
    case "prepared":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "ready":
      return "border-indigo-200 bg-indigo-50 text-indigo-800";
    case "dispatched":
      return "border-orange-200 bg-orange-50 text-orange-800";
    case "delivered":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    default:
      return "border-gray-200 bg-white text-gray-800";
  }
}

type Role =
  | "driver"
  | "restaurant"
  | "client"
  | "vendor"
  | "seller";

type Props = {
  orderId?: string;
  role?: Role;
};

export default function OrderAlerts({ orderId, role = "driver" }: Props) {
  const [enabled, setEnabled] = useState<boolean>(true);
  const [volume, setVolume] = useState<number>(0.6);

  useEffect(() => {
    try {
      const rawEn = localStorage.getItem(LS_ENABLED);
      if (rawEn !== null) setEnabled(rawEn === "true");

      const rawVol = localStorage.getItem(LS_VOLUME);
      const v = rawVol ? parseFloat(rawVol) : NaN;
      if (isFinite(v)) setVolume(Math.max(0, Math.min(1, v)));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_ENABLED, String(enabled));
    } catch {}
  }, [enabled]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_VOLUME, String(volume));
    } catch {}
  }, [volume]);

  const [last, setLast] = useState<string | null>(null);
  const lastRef = useRef<string | null>(null);
  const lastUpdatedAtRef = useRef<string>("");
  const lastBeepAtRef = useRef<number>(0);
  const statusCooldownRef = useRef<Record<string, number>>({});

  function shouldBeep(now: number, status: string | null) {
    if (now - lastBeepAtRef.current <= 1500) return false;
    if (status) {
      const lastForThis = statusCooldownRef.current[status] ?? 0;
      if (now - lastForThis <= 60000) return false;
    }
    return true;
  }

  function markBeep(now: number, status: string | null) {
    lastBeepAtRef.current = now;
    if (status) statusCooldownRef.current[status] = now;
  }

  const [toast, setToast] = useState<{
    msg: string;
    visible: boolean;
    cls: string;
  }>({
    msg: "",
    visible: false,
    cls: "border-gray-200 bg-white text-gray-800",
  });

  function showToastForStatus(status: string | null) {
    const cls = statusToToastClass(status);
    const msg = `Statut → ${String(status ?? "").toUpperCase()}`;
    setToast({ msg, visible: true, cls });
    setTimeout(() => setToast((t) => ({ ...t, visible: false })), 2500);
  }

  useEffect(() => {
    mmdAudio.unlockOnInteraction();
  }, []);

  useEffect(() => {
    if (!orderId) return;

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("status, updated_at")
        .eq("id", orderId)
        .maybeSingle();

      if (!cancelled && !error) {
        const initial = (data as any)?.status ?? null;
        const upd = (data as any)?.updated_at ?? "";
        setLast(initial);
        lastRef.current = initial;
        lastUpdatedAtRef.current = upd || "";
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  useEffect(() => {
    if (!orderId) return;

    const canNotify = () =>
      enabled && (role === "driver" || role === "restaurant" || role === "client");

    const handleStatus = async (newStatus: string | null, newUpdated: string) => {
      const now = Date.now();
      if (!newStatus || !IMPORTANT_STATUSES.has(newStatus)) return;

      const statusChanged = newStatus !== lastRef.current;
      const updatedAtAdvanced =
        newUpdated && newUpdated !== lastUpdatedAtRef.current;

      if ((statusChanged || updatedAtAdvanced) && shouldBeep(now, newStatus)) {
        if (canNotify()) {
          mmdAudio.playForOrderStatus(newStatus);
          showToastForStatus(newStatus);
        }
        markBeep(now, newStatus);
        lastRef.current = newStatus;
        if (updatedAtAdvanced) lastUpdatedAtRef.current = newUpdated;
        setLast(newStatus);
      }
    };

    const chOrders = supabase
      .channel(`orders-alerts-${orderId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `id=eq.${orderId}` },
        async (payload) => {
          const newStatus = (payload.new as any)?.status ?? null;
          const newUpdated = (payload.new as any)?.updated_at ?? "";
          await handleStatus(newStatus, newUpdated);
        }
      )
      .subscribe();

    const chHist = supabase
      .channel(`orders-hist-${orderId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "order_status_history",
          filter: `order_id=eq.${orderId}`,
        },
        async (payload) => {
          const ns = (payload.new as any)?.new_status ?? null;
          await handleStatus(ns, "");
        }
      )
      .subscribe();

    const interval = setInterval(async () => {
      try {
        const { data, error } = await supabase
          .from("orders")
          .select("status, updated_at")
          .eq("id", orderId)
          .maybeSingle();

        if (error || !data) return;

        const polled = (data as any)?.status ?? null;
        const upd = (data as any)?.updated_at ?? "";
        await handleStatus(polled, upd);
      } catch {}
    }, 2000);

    return () => {
      supabase.removeChannel(chOrders);
      supabase.removeChannel(chHist);
      clearInterval(interval);
    };
  }, [orderId, role, enabled, volume]);

  return (
    <>
      <div className="text-xs text-gray-600 flex flex-wrap items-center gap-2">
        <span>
          🔔 Alertes actives ({role})
          {!orderId ? (
            <span className="ml-2 text-[11px] text-gray-400">
              (pas de orderId → pas de suivi)
            </span>
          ) : null}
        </span>

        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Son ON/OFF
        </label>

        <label className="flex items-center gap-2">
          Volume
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
          />
          <span className="tabular-nums">{Math.round(volume * 100)}%</span>
        </label>

        <button
          type="button"
          onClick={() => {
            mmdAudio.playForOrderStatus("ready");
            showToastForStatus("ready");
          }}
          className="px-2 py-1 border rounded text-[11px]"
          title="Clique pour autoriser le son et tester"
        >
          Test son premium
        </button>

        {orderId ? (
          <span className="ml-auto text-[11px] text-gray-400">
            last: {last ? last.toUpperCase() : "—"}
          </span>
        ) : null}
      </div>

      <div className="fixed top-4 right-4 z-50">
        <div
          className={
            "transition-all duration-300 " +
            (toast.visible
              ? "opacity-100 translate-y-0"
              : "opacity-0 -translate-y-2 pointer-events-none")
          }
        >
          <div
            className={
              "rounded-xl shadow-lg border px-4 py-2 text-sm " + toast.cls
            }
          >
            {toast.msg || "Notification"}
          </div>
        </div>
      </div>
    </>
  );
}
