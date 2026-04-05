"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type Role = "client" | "driver" | "restaurant" | "admin";
type Member = { user_id: string; role: Role };

export default function MembersList({ orderId }: { orderId: string }) {
  const [rows, setRows] = useState<Member[]>([]);
  const [role, setRole] = useState<Role>("driver");
  const [meId, setMeId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Charge auth + membres + mon rôle
  useEffect(() => {
    let mounted = true;

    const loadAll = async () => {
      setLoading(true); setErr(null);

      // 1) Qui suis-je ?
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) {
        setErr(authErr.message);
      }
      const uid = authData?.user?.id ?? null;
      if (mounted) setMeId(uid);

      // 2) Membres de la commande
      const { data: mdata, error: mErr } = await supabase
        .from("order_members")
        .select("user_id, role")
        .eq("order_id", orderId)
        .order("joined_at", { ascending: true });

      if (mErr) {
        if (mounted) { setErr(mErr.message); setRows([]); setMyRole(null); }
      } else {
        const list = (mdata || []) as Member[];
        if (mounted) {
          setRows(list);
          const mine = uid ? list.find(x => x.user_id === uid) : undefined;
          setMyRole(mine?.role ?? null);
        }
      }

      if (mounted) setLoading(false);
    };

    loadAll();

    // Realtime
    const ch = supabase
      .channel(`members:${orderId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "order_members", filter: `order_id=eq.${orderId}` },
        () => { /* recharge à chaque changement */ loadAll(); }
      )
      .subscribe();

    return () => { mounted = false; supabase.removeChannel(ch); };
  }, [orderId]);

  // Rejoindre / Quitter
  const join = async () => {
    setErr(null);
    const { error } = await supabase.rpc("join_order", { p_order_id: orderId, p_role: role });
    if (error) setErr(error.message);
  };

  const leave = async (user_id: string) => {
    setErr(null);
    const { error } = await supabase
      .from("order_members")
      .delete()
      .eq("order_id", orderId)
      .eq("user_id", user_id);
    if (error) setErr(error.message);
  };

  // Filtrage: si pas admin -> ne voir que moi
  const visibleRows = useMemo(() => {
    if (myRole === "admin") return rows;
    if (!meId) return []; // pas connecté -> rien
    return rows.filter(r => r.user_id === meId);
  }, [rows, myRole, meId]);

  return (
    <div className="space-y-2">
      {/* Bandeau léger d'état */}
      <div className="text-xs text-gray-600">
        <div><b>Order:</b> <code>{orderId}</code></div>
        <div><b>User:</b> <code>{meId ?? "non connecté"}</code> <b>Role:</b> <code>{myRole ?? "-"}</code></div>
        {err && <div className="text-red-600"><b>Erreur:</b> {err}</div>}
      </div>

      <div className="flex gap-2 items-center">
        <select value={role} onChange={e => setRole(e.target.value as Role)} className="border rounded px-2 py-1">
          <option value="client">client</option>
          <option value="driver">driver</option>
          <option value="restaurant">restaurant</option>
          <option value="admin">admin</option>
        </select>
        <button onClick={join} className="border rounded px-3">Rejoindre</button>
      </div>

      <div className="border rounded p-2">
        {loading ? (
          "Chargement…"
        ) : visibleRows.length === 0 ? (
          "Aucun membre."
        ) : (
          visibleRows.map((m) => (
            <div key={m.user_id} className="flex items-center justify-between border-b py-1">
              <span className="font-mono text-xs">{m.user_id}</span>
              <span className="text-sm">{m.role}</span>
              {/* Autoriser la suppression pour tout le monde côté UI; RLS décidera en DB */}
              <button onClick={() => leave(m.user_id)} className="text-red-600 text-sm">retirer</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
