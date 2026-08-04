"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

export type GeocodedAddress = {
  label: string;
  latitude: number | null;
  longitude: number | null;
};

type Props = {
  value: string;
  onChange: (next: GeocodedAddress) => void;
  placeholder?: string;
};

type Suggestion = {
  id: string;
  fullAddress: string;
  latitude: number;
  longitude: number;
};

/**
 * Mapbox Places autocomplete aligned with POST /api/mapbox/places
 * (Bearer auth + { suggestions: [...] } response).
 */
export default function MapboxAddressField({
  value,
  onChange,
  placeholder,
}: Props) {
  const [q, setQ] = useState(value);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setQ(value);
  }, [value]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) {
      setItems([]);
      setError(null);
      return;
    }
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          const token = session?.access_token;
          if (!token) {
            setItems([]);
            setError("Connectez-vous pour rechercher une adresse.");
            return;
          }

          const res = await fetch("/api/mapbox/places", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ query: term, limit: 6 }),
          });
          const body = (await res.json().catch(() => ({}))) as {
            ok?: boolean;
            suggestions?: Array<{
              id?: string;
              fullAddress?: string;
              name?: string;
              latitude?: number;
              longitude?: number;
            }>;
            error?: string;
          };

          if (!res.ok || body.ok === false) {
            setItems([]);
            setError(body.error ?? "Recherche d'adresse indisponible.");
            return;
          }

          const mapped = (body.suggestions ?? [])
            .filter(
              (s) =>
                Number.isFinite(Number(s.latitude)) &&
                Number.isFinite(Number(s.longitude)) &&
                String(s.fullAddress ?? s.name ?? "").trim(),
            )
            .map((s, i) => ({
              id: String(s.id ?? i),
              fullAddress: String(s.fullAddress ?? s.name ?? "").trim(),
              latitude: Number(s.latitude),
              longitude: Number(s.longitude),
            }));

          setItems(mapped);
          setOpen(mapped.length > 0);
          setError(mapped.length ? null : "Aucune adresse trouvée.");
        } catch {
          setItems([]);
          setError("Recherche d'adresse impossible.");
        }
      })();
    }, 280);
    return () => clearTimeout(handle);
  }, [q]);

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          onChange({ label: e.target.value, latitude: null, longitude: null });
        }}
        placeholder={placeholder ?? "Search address…"}
        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
        autoComplete="off"
      />
      {error ? (
        <p className="mt-1 text-xs text-amber-700">{error}</p>
      ) : null}
      {open && items.length > 0 ? (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() => {
                  setQ(item.fullAddress);
                  setOpen(false);
                  setError(null);
                  onChange({
                    label: item.fullAddress,
                    latitude: item.latitude,
                    longitude: item.longitude,
                  });
                }}
              >
                {item.fullAddress}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
