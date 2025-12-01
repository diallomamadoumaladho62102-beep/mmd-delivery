"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type Profile = { full_name?: string | null; avatar_url?: string | null };
type Member = {
  user_id: string;
  role: "client" | "driver" | "restaurant" | "admin";
  joined_at?: string | null;
  profiles?: Profile | Profile[] | null;
};

export default function MembersList({ orderId }: { orderId: string }) {
  const [rows, setRows] = useState<Member[]>([]);
  const [role, setRole] = useState<Member["role"]>("driver");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);

    // Si la FK (order_members.user_id -> profiles.id) existe, on peut joindre directement:
    const q = supabase
      .from("order_members")
      .select("user_id, role, joined_at, profiles:profiles!order_members_user_fk(full_name,avatar_url)")
      .eq("order_id", orderId)
      .order("joined_at", { ascending: true });

    const { data, error } = await q;
    if (error) { setErr(error.message); setRows([]); setLoading(false); return; }
    setRows(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`members:${orderId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "order_members", filter: `order_id=eq.${orderId}` },
        () => load()
      ).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [orderId]);

  const join = async () => {
    setErr(null);
    await supabase.rpc("join_order", { p_order_id: orderId, p_role: role });
    await load();
  };

  const leave = async (user_id: string) => {
    setErr(null);
    await supabase.from("order_members").delete().eq("order_id", orderId).eq("user_id", user_id);
    await load();
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2 items-center">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Member["role"])}
          className="border rounded px-2 py-1"
        >
          <option value="client">client</option>
          <option value="driver">driver</option>
          <option value="restaurant">restaurant</option>
          <option value="admin">admin</option>
        </select>
        <button onClick={join} className="border rounded px-3">Rejoindre</button>
      </div>

      {err ? <div className="text-sm text-red-600">{err}</div> : null}
      {rows.length === 0 && !loading ? (
        <div className="text-sm text-gray-500">Aucun membre.</div>
      ) : null}

      <ul className="space-y-2">
        {rows.map((m) => {
          const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
          return (
            <li key={m.user_id} className="flex items-center justify-between border rounded-lg p-2">
              <div className="flex items-center gap-3">
                {p?.avatar_url ? (
                  <img src={p.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gray-200" />
                )}
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{p?.full_name ?? "Utilisateur"}</span>
                  <span className="font-mono text-xs opacity-70">{m.user_id}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm">{m.role}</span>
                <button onClick={() => leave(m.user_id)} className="text-red-600 text-sm">retirer</button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

