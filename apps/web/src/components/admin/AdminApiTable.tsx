"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

type Column<T> = {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
};

type Props<T extends Record<string, unknown>> = {
  apiPath: string;
  columns: Column<T>[];
  itemsKey?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
};

function cellValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}

export default function AdminApiTable<T extends Record<string, unknown>>({
  apiPath,
  columns,
  itemsKey = "items",
  searchPlaceholder = "Rechercher…",
  emptyLabel = "Aucun résultat",
}: Props<T>) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const url = new URL(apiPath, window.location.origin);
    if (query.trim()) url.searchParams.set("q", query.trim());

    const res = await fetch(url.toString(), { cache: "no-store" });
    const body = await res.json().catch(() => ({}));

    if (!res.ok || !body.ok) {
      setError(body.error ?? "Échec chargement");
      setRows([]);
      setLoading(false);
      return;
    }

    setRows((body[itemsKey] as T[]) ?? []);
    setLoading(false);
  }, [apiPath, itemsKey, query]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-10 w-full max-w-md rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
        />
        <button
          type="button"
          onClick={() => void load()}
          className="h-10 rounded-xl border border-slate-900 bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
        >
          Actualiser
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500">Chargement…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          {emptyLabel}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {columns.map((col) => (
                  <th key={col.key} className="px-4 py-3 font-semibold">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={String(row.id ?? idx)} className="border-b border-slate-100">
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3 text-slate-700">
                      {col.render
                        ? col.render(row)
                        : cellValue(row[col.key as keyof T])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
