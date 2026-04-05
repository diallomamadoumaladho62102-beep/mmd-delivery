"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type Member = { order_id: string; user_id: string; role: string | null };
type Profile = { id: string; full_name: string | null };

// -- Petit composant toast interne (sans lib)
function ToastStack({ toasts }: { toasts: { id: string; text: string }[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      {toasts.map(t => (
        <div
          key={t.id}
          className="bg-black/85 text-white text-xs px-3 py-2 rounded shadow-lg"
          role="status"
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

export default function MembersBadge({ orderId }: { orderId: string }) {
  const [rows, setRows] = useState<Member[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [err, setErr] = useState<string | null>(null);

  // UI states
  const [open, setOpen] = useState(false);       // tooltip ouvert
  const [pulse, setPulse] = useState(false);     // effet pulse
  const [toasts, setToasts] = useState<{ id: string; text: string }[]>([]);
  const toastTimerRef = useRef<number | null>(null);

  function addToast(text: string) {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, text }]);
    // auto dismiss
    window.setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }

  async function load() {
    try {
      setErr(null);
      const { data, error } = await supabase
        .from("order_members")
        .select("order_id, user_id, role")
        .eq("order_id", orderId);
      if (error) throw error;
      const list = (data as Member[]) ?? [];
      setRows(list);

      // charger les profils
      const uids = Array.from(new Set(list.map(m => m.user_id))).filter(Boolean);
      if (uids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", uids);
        const map: Record<string, Profile> = {};
        (profs ?? []).forEach((p: any) => (map[p.id] = { id: p.id, full_name: p.full_name ?? null }));
        setProfiles(map);
      } else {
        setProfiles({});
      }
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }

  useEffect(() => {
    void load();

    const ch = supabase
      .channel(`order-members-${orderId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_members", filter: `order_id=eq.${orderId}` },
        (payload: any) => {
          // Rafraîchir la liste
          void load();

          // Effet visuel + toast
          setPulse(true);
          window.setTimeout(() => setPulse(false), 600);

          const role =
            (payload.new?.role ?? payload.old?.role ?? "member")
              .toString()
              .toLowerCase();

          if (payload.eventType === "INSERT") {
            addToast(`Un ${role} a rejoint la commande`);
          } else if (payload.eventType === "DELETE") {
            addToast(`Un ${role} a quitté la commande`);
          } else if (payload.eventType === "UPDATE") {
            addToast(`Le rôle d'un membre est passé à “${role}”`);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, [orderId]);

  const count = rows.length;

  // Aperçu rôles
  const rolesPreview = useMemo(() => {
    const roles = Array.from(new Set(rows.map(r => (r.role || "member").toLowerCase())));
    return roles.slice(0, 3).join(", ") + (roles.length > 3 ? "…" : "");
  }, [rows]);

  // Contenu tooltip (liste noms + rôles)
  const tooltip = useMemo(() => {
    if (count === 0) return "Aucun membre";
    const items = rows
      .map(r => {
        const name = profiles[r.user_id]?.full_name || r.user_id.slice(0, 8);
        const role = (r.role || "member").toLowerCase();
        return `${name} — ${role}`;
      })
      .sort((a, b) => a.localeCompare(b));
    return items.join("\n");
  }, [rows, profiles, count]);

  return (
    <>
      <div
        className={[
          "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs relative",
          pulse ? "ring-2 ring-green-400 ring-offset-2" : "",
        ].join(" ")}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label={`Membres de la commande : ${count}`}
      >
        <span className="font-medium">{count} membre{count > 1 ? "s" : ""}</span>
        {count > 0 && <span className="text-gray-500">• {rolesPreview}</span>}
        {err && <span className="text-red-600 ml-2">({err})</span>}

        {/* Tooltip custom */}
        {open && (
          <div
            className="absolute left-0 top-[120%] z-20 w-64 max-w-[80vw] rounded-md border bg-white p-2 text-[11px] shadow-xl"
            role="tooltip"
          >
            <div className="mb-1 font-medium text-gray-700">Membres</div>
            <pre className="whitespace-pre-wrap text-[11px] text-gray-700 leading-relaxed">{tooltip}</pre>
          </div>
        )}
      </div>

      {/* Toasts */}
      <ToastStack toasts={toasts} />
    </>
  );
}

