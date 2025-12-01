"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type TypingRow = { order_id: string; user_id: string; is_typing: boolean; updated_at: string };
type Profile = { id: string; full_name?: string | null };

export default function TypingIndicator({ orderId }: { orderId: string }) {
  const [rows, setRows] = useState<TypingRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const intervalRef = useRef<number | null>(null);

  async function load() {
    const { data, error } = await supabase
      .from("order_typing")
      .select("order_id, user_id, is_typing, updated_at")
      .eq("order_id", orderId);
    if (error) return;
    const list = (data as TypingRow[]) ?? [];
    setRows(list);
    // hydrate profils
    const uids = Array.from(new Set(list.map(x => x.user_id)));
    if (uids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", uids);
      const map: Record<string, Profile> = {};
      (profs ?? []).forEach((p: any) => (map[p.id] = p));
      setProfiles(prev => ({ ...prev, ...map }));
    }
  }

  useEffect(() => {
    void load();
    const ch = supabase
      .channel(`typing-${orderId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "order_typing", filter: `order_id=eq.${orderId}` },
        () => { void load(); }
      )
      .subscribe();

    // petit garbage collector local: on masque les entrées trop anciennes
    intervalRef.current = window.setInterval(() => {
      setRows(prev => {
        const now = Date.now();
        return prev.filter(r => {
          const age = now - new Date(r.updated_at).getTime();
          // 6 secondes de “typing” max si pas d’update
          return r.is_typing && age < 6000;
        });
      });
    }, 1500) as unknown as number;

    return () => {
      supabase.removeChannel(ch);
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [orderId]);

  const typingNames = useMemo(() => {
    const active = rows
      .filter(r => r.is_typing && Date.now() - new Date(r.updated_at).getTime() < 6000);
    const unique = Array.from(new Set(active.map(r => r.user_id)));
    const names = unique.map(uid => profiles[uid]?.full_name || uid.slice(0, 8));
    return names;
  }, [rows, profiles]);

  if (typingNames.length === 0) return null;

  const label = typingNames.length === 1
    ? `${typingNames[0]} écrit…`
    : `${typingNames.slice(0,2).join(", ")}${typingNames.length>2 ? "…" : ""} écrivent…`;

  return (
    <div className="text-xs text-gray-500 px-1">{label}</div>
  );
}

