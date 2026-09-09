"use client";


import { useAdminT } from "@/i18n/useAdminT";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type ItemRow = {
  name: string;
  category?: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
};

type OrderRow = {
  id: string;
  restaurant_id: string | null;
  items_json: ItemRow[] | null;
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
};

type RestaurantProfile = {
  id: string;
  full_name: string | null;
};

export default function OrderItemsCard({ orderId }: { orderId: string }) {
  const { t } = useAdminT();

  const [order, setOrder] = useState<OrderRow | null>(null);
  const [restaurant, setRestaurant] = useState<RestaurantProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setErr(null);

      const { data, error } = await supabase
        .from("orders")
        .select("id, restaurant_id, items_json, subtotal, tax, total, currency")
        .eq("id", orderId)
        .maybeSingle();

      if (!mounted) return;

      if (error) {
        setErr(error.message);
        setLoading(false);
        return;
      }

      const ord = data as OrderRow | null;
      setOrder(ord);

      if (ord?.restaurant_id) {
        const { data: rest, error: restErr } = await supabase
          .from("profiles")
          .select("id, full_name")
          .eq("id", ord.restaurant_id)
          .maybeSingle();

        if (!mounted) return;

        if (!restErr && rest) {
          setRestaurant(rest as RestaurantProfile);
        }
      }

      setLoading(false);
    }

    load();
    return () => {
      mounted = false;
    };
  }, [orderId]);

  if (loading) {
    return (
      <div className="border rounded-xl p-4 bg-white">
        <p className="text-sm text-gray-600">{t("Chargement des détails…")}</p>
      </div>
    );
  }

  if (err) {
    return (
      <div className="border border-red-300 rounded-xl p-4 bg-red-50 text-sm text-red-700">
        Erreur: {err}
      </div>
    );
  }

  if (!order) {
    return (
      <div className="border rounded-xl p-4 bg-white text-sm text-gray-600">
        {t("Commande introuvable.")}
      </div>
    );
  }

  const items = (order.items_json || []) as ItemRow[];

  return (
    <div className="border rounded-2xl p-4 bg-white space-y-4">
      {/* Restaurant */}
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t("Restaurant")}</h2>
        <p className="text-sm text-gray-700">
          {restaurant?.full_name || "Restaurant non renseigné"}
        </p>
      </div>

      {/* Panier */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">{t("Panier")}</h2>
        {items.length === 0 ? (
          <p className="text-sm text-gray-500">{t("Aucun article enregistré.")}</p>
        ) : (
          <div className="border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-2">{t("Article")}</th>
                  <th className="text-right px-3 py-2">{t("Qté")}</th>
                  <th className="text-right px-3 py-2">{t("Prix")}</th>
                  <th className="text-right px-3 py-2">{t("Total")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-2">
                      <div>{it.name}</div>
                      {it.category && (
                        <div className="text-xs text-gray-500">
                          {it.category}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{it.quantity}</td>
                    <td className="px-3 py-2 text-right">
                      ${Number(it.unit_price).toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      ${Number(it.line_total).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Résumé */}
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t("Résumé")}</h2>
        <div className="flex justify-between text-sm">
          <span>{t("Sous-total")}</span>
          <span>
            ${Number(order.subtotal).toFixed(2)} {order.currency}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span>{t("Taxes")}</span>
          <span>
            ${Number(order.tax).toFixed(2)} {order.currency}
          </span>
        </div>
        <div className="flex justify-between text-sm font-semibold border-t pt-2 mt-1">
          <span>{t("Total")}</span>
          <span>
            ${Number(order.total).toFixed(2)} {order.currency}
          </span>
        </div>
      </div>
    </div>
  );
}
