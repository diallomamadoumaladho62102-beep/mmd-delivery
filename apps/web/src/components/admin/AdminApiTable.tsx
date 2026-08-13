"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { adminFetch } from "@/lib/adminBrowserAuth";
import {
  CC_BTN_PRIMARY,
  CC_BTN_SECONDARY,
  CC_INPUT,
  CC_TABLE,
  CC_TABLE_WRAP,
} from "@/components/admin/adminUi";

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

    const res = await adminFetch(url.toString());
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
          className={`${CC_INPUT} max-w-md`}
        />
        <button type="button" onClick={() => void load()} className={CC_BTN_PRIMARY}>
          Actualiser
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-[var(--cc-muted)]">Chargement…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="cc-card p-6 text-sm text-[var(--cc-muted)]">{emptyLabel}</div>
      ) : (
        <div className={CC_TABLE_WRAP}>
          <table className={CC_TABLE}>
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.key}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={String(row.id ?? idx)}>
                  {columns.map((col) => (
                    <td key={col.key}>
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
