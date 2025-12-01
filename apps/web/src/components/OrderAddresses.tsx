"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type Row = {
  id: string;
  pickup_address?: string | null;
  dropoff_address?: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
};

function mapsLink(addr?: string | null, lat?: number | null, lng?: number | null) {
  if (lat!=null && lng!=null) return `https://www.google.com/maps?q=${lat},${lng}`;
  if (addr) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
  return "#";
}

export default function OrderAddresses({ orderId }: { orderId: string }) {
  const [row, setRow] = useState<Row | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      setErr(null);
      const { data, error } = await supabase
        .from("orders")
        .select("id,pickup_address,dropoff_address,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng")
        .eq("id", orderId)
        .maybeSingle();
      if (error) throw error;
      setRow(data as Row | null);
    } catch (e:any) {
      setErr(e?.message || String(e));
    }
  }

  useEffect(() => { void load(); }, [orderId]);

  if (!row) return null;

  const pUrl = mapsLink(row.pickup_address, row.pickup_lat, row.pickup_lng);
  const dUrl = mapsLink(row.dropoff_address, row.dropoff_lat, row.dropoff_lng);

  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <div className="border rounded-2xl p-4">
        <div className="text-xs text-gray-500">Pickup</div>
        <div className="text-sm">{row.pickup_address || "(non renseigné)"}</div>
        {(row.pickup_lat!=null && row.pickup_lng!=null) && (
          <div className="text-xs text-gray-500 mt-1">({row.pickup_lat}, {row.pickup_lng})</div>
        )}
        <a className="inline-block mt-2 text-sm px-3 py-1.5 border rounded hover:bg-gray-50" href={pUrl} target="_blank" rel="noreferrer">
          Ouvrir dans Maps
        </a>
      </div>
      <div className="border rounded-2xl p-4">
        <div className="text-xs text-gray-500">Dropoff</div>
        <div className="text-sm">{row.dropoff_address || "(non renseigné)"}</div>
        {(row.dropoff_lat!=null && row.dropoff_lng!=null) && (
          <div className="text-xs text-gray-500 mt-1">({row.dropoff_lat}, {row.dropoff_lng})</div>
        )}
        <a className="inline-block mt-2 text-sm px-3 py-1.5 border rounded hover:bg-gray-50" href={dUrl} target="_blank" rel="noreferrer">
          Ouvrir dans Maps
        </a>
      </div>
      {err && <div className="col-span-full text-xs text-red-600">{err}</div>}
    </div>
  );
}

