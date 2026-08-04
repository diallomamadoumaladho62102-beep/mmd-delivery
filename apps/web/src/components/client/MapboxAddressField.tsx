"use client";

import { useEffect, useState } from "react";

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
  place_name?: string;
  center?: [number, number];
};

/**
 * Lightweight Mapbox Places autocomplete for client address quality.
 */
export default function MapboxAddressField({
  value,
  onChange,
  placeholder,
}: Props) {
  const [q, setQ] = useState(value);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setQ(value);
  }, [value]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) {
      setItems([]);
      return;
    }
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const url = new URL("/api/mapbox/places", window.location.origin);
          url.searchParams.set("q", term);
          const res = await fetch(url.toString());
          const body = await res.json().catch(() => ({}));
          const features = Array.isArray(body.features)
            ? body.features
            : Array.isArray(body.data)
              ? body.data
              : [];
          setItems(
            features.slice(0, 6).map((f: Record<string, unknown>, i: number) => ({
              id: String(f.id ?? i),
              place_name: String(f.place_name ?? f.label ?? ""),
              center: Array.isArray(f.center)
                ? (f.center as [number, number])
                : undefined,
            })),
          );
          setOpen(true);
        } catch {
          setItems([]);
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
      {open && items.length > 0 ? (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() => {
                  const label = item.place_name || q;
                  const lng = item.center?.[0] ?? null;
                  const lat = item.center?.[1] ?? null;
                  setQ(label);
                  setOpen(false);
                  onChange({
                    label,
                    latitude: lat,
                    longitude: lng,
                  });
                }}
              >
                {item.place_name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
