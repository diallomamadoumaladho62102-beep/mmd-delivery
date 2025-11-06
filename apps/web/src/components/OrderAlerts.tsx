"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

const IMPORTANT_STATUSES = new Set(["assigned","accepted","prepared","ready","dispatched","delivered"]);
const LS_ENABLED = "mmdAlertsEnabled";
const LS_VOLUME  = "mmdAlertsVolume"; // 0..1

// ---- Audio globals
let ACtx: AudioContext | null = null;
let MasterGain: GainNode | null = null;
let unlocked = false;

function statusToFreq(status: string | null): number {
  switch (status) {
    case "assigned":   return 440;     // A4
    case "accepted":   return 523.25;  // C5
    case "prepared":   return 659.25;  // E5
    case "ready":      return 880;     // A5
    case "dispatched": return 988;     // B5
    case "delivered":  return 1174.66; // D6 (~)
    default:           return 880;
  }
}

function statusToToastClass(status: string | null): string {
  switch (status) {
    case "assigned":   return "border-blue-200 bg-blue-50 text-blue-800";
    case "accepted":   return "border-sky-200 bg-sky-50 text-sky-800";
    case "prepared":   return "border-amber-200 bg-amber-50 text-amber-800";
    case "ready":      return "border-indigo-200 bg-indigo-50 text-indigo-800";
    case "dispatched": return "border-orange-200 bg-orange-50 text-orange-800";
    case "delivered":  return "border-emerald-200 bg-emerald-50 text-emerald-800";
    default:           return "border-gray-200 bg-white text-gray-800";
  }
}

async function ensureAudioUnlocked(volume = 0.6) {
  try {
    if (!ACtx) {
      ACtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (ACtx.state === "suspended") { await ACtx.resume(); }
    if (!MasterGain) {
      MasterGain = ACtx.createGain();
      MasterGain.gain.value = volume;
      MasterGain.connect(ACtx.destination);
    }
    unlocked = true;
  } catch {}
}

async function playBeepWebAudio(freq: number, volume: number) {
  await ensureAudioUnlocked(volume);
  if (!ACtx || !unlocked || !MasterGain) return false;
  try {
    const ctx = ACtx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    o.connect(g);
    g.connect(MasterGain);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + 0.02);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.stop(ctx.currentTime + 0.4);
    return true;
  } catch {
    return false;
  }
}

const BEEP_DATA_URI = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABYAAAAAAACAgICAgP///wAAAP///wAAAAAA";
async function playBeepFallback(volume: number) {
  try { const a = new Audio(BEEP_DATA_URI); a.volume = Math.max(0, Math.min(1, volume)); await a.play(); return true; } catch { return false; }
}
async function playBeepForStatus(status: string | null, volume: number) {
  const freq = statusToFreq(status);
  const ok = await playBeepWebAudio(freq, volume);
  if (!ok) await playBeepFallback(volume);
}

type Props = { orderId: string; role?: "driver"|"restaurant"|"client"|"vendor"|"seller" };

export default function OrderAlerts({ orderId, role = "driver" }: Props) {
  // Préférences (chargées après montage)
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
  useEffect(() => { try { localStorage.setItem(LS_ENABLED, String(enabled)); } catch {} }, [enabled]);
  useEffect(() => { try { localStorage.setItem(LS_VOLUME, String(volume)); if (MasterGain) MasterGain.gain.value = volume; } catch {} }, [volume]);

  // Derniers états / anti-spam
  const [last, setLast] = useState<string | null>(null);
  const lastRef = useRef<string | null>(null);
  const lastUpdatedAtRef = useRef<string>("");
  const lastBeepAtRef = useRef<number>(0);              // debounce global
  const statusCooldownRef = useRef<Record<string, number>>({}); // cooldown par statut

  function shouldBeep(now: number, status: string | null) {
    // Debounce global 1.5s
    if (now - lastBeepAtRef.current <= 1500) return false;
    // Cooldown par statut 60s
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

  // Toasts
  const [toast, setToast] = useState<{msg:string; visible:boolean; cls:string}>({ msg: "", visible: false, cls: "border-gray-200 bg-white text-gray-800" });
  function showToastForStatus(status: string | null) {
    const cls = statusToToastClass(status);
    const msg = `Statut → ${String(status ?? "").toUpperCase()}`;
    setToast({ msg, visible: true, cls });
    setTimeout(() => setToast(t => ({ ...t, visible: false })), 2500);
  }

  // Déverrouiller audio au premier geste
  useEffect(() => {
    const unlock = async () => { await ensureAudioUnlocked(volume); };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Charger statut initial
  useEffect(() => {
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
    return () => { cancelled = true; };
  }, [orderId]);

  // Realtime + History + Polling
  useEffect(() => {
    const canNotify = () => enabled && (role === "driver" || role === "restaurant");

    // ORDERS
    const chOrders = supabase
      .channel(`orders-alerts-${orderId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `id=eq.${orderId}` },
        async (payload) => {
          const now = Date.now();
          const newStatus = (payload.new as any)?.status ?? null;
          const newUpdated = (payload.new as any)?.updated_at ?? "";

          if (!newStatus || !IMPORTANT_STATUSES.has(newStatus)) return;

          const statusChanged = newStatus !== lastRef.current;
          const updatedAtAdvanced = newUpdated && newUpdated !== lastUpdatedAtRef.current;

          if ((statusChanged || updatedAtAdvanced) && shouldBeep(now, newStatus)) {
            if (canNotify()) {
              await playBeepForStatus(newStatus, volume);
              showToastForStatus(newStatus);
            }
            markBeep(now, newStatus);
            lastRef.current = newStatus;
            if (updatedAtAdvanced) lastUpdatedAtRef.current = newUpdated;
            setLast(newStatus);
          }
        }
      )
      .subscribe();

    // ORDER_STATUS_HISTORY (INSERT)
    const chHist = supabase
      .channel(`orders-hist-${orderId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "order_status_history", filter: `order_id=eq.${orderId}` },
        async (payload) => {
          const now = Date.now();
          const ns = (payload.new as any)?.new_status ?? null;
          if (!ns || !IMPORTANT_STATUSES.has(ns)) return;

          if (shouldBeep(now, ns)) {
            if (canNotify()) {
              await playBeepForStatus(ns, volume);
              showToastForStatus(ns);
            }
            markBeep(now, ns);
            lastRef.current = ns;
            setLast(ns);
          }
        }
      )
      .subscribe();

    // Polling de secours
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
        if (!polled || !IMPORTANT_STATUSES.has(polled)) return;

        const now = Date.now();
        const statusChanged = polled !== lastRef.current;
        const updatedAtAdvanced = upd && upd !== lastUpdatedAtRef.current;

        if ((statusChanged || updatedAtAdvanced) && shouldBeep(now, polled)) {
          if (canNotify()) {
            await playBeepForStatus(polled, volume);
            showToastForStatus(polled);
          }
          markBeep(now, polled);
          lastRef.current = polled;
          if (updatedAtAdvanced) lastUpdatedAtRef.current = upd;
          setLast(polled);
        }
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
      {/* Barre de contrôle */}
      <div className="text-xs text-gray-600 flex flex-wrap items-center gap-2">
        <span>🔔 Alertes actives ({role})</span>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Son ON/OFF
        </label>
        <label className="flex items-center gap-2">
          Volume
          <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} />
          <span className="tabular-nums">{Math.round(volume * 100)}%</span>
        </label>
        <button
          type="button"
          onClick={async () => { await ensureAudioUnlocked(volume); await playBeepForStatus("ready", volume); showToastForStatus("ready"); }}
          className="px-2 py-1 border rounded text-[11px]"
          title="Clique pour autoriser le son et tester"
        >
          Test bip
        </button>
      </div>

      {/* Toast */}
      <div className="fixed top-4 right-4 z-50">
        <div className={"transition-all duration-300 " + (toast.visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2 pointer-events-none")}>
          <div className={"rounded-xl shadow-lg border px-4 py-2 text-sm " + toast.cls}>
            {toast.msg || "Notification"}
          </div>
        </div>
      </div>
    </>
  );
}
