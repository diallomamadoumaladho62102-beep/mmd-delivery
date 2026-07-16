"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";

type SellerRow = {
  id: string;
  business_name: string;
  status: string;
  city: string;
  is_accepting_orders: boolean;
  logo_url: string | null;
  cover_image_url: string | null;
  document_urls: unknown;
};

type ProductRow = {
  id: string;
  title: string;
  price_cents: number;
  currency: string;
  active: boolean;
  stock_qty: number | null;
};

type OrderRow = {
  id: string;
  status: string;
  total_cents: number;
  currency: string;
  created_at: string;
  refund_status: string | null;
};

function asUrlList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function money(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format((Number(cents) || 0) / 100);
}

export default function SellerDashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seller, setSeller] = useState<SellerRow | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [businessName, setBusinessName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [documentUrlsText, setDocumentUrlsText] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id;
      if (!userId) {
        router.replace("/login");
        return;
      }

      const { data: sellerRow, error: sellerError } = await supabase
        .from("sellers")
        .select(
          "id,business_name,status,city,is_accepting_orders,logo_url,cover_image_url,document_urls"
        )
        .eq("user_id", userId)
        .maybeSingle();

      if (sellerError) throw sellerError;
      if (!sellerRow) {
        setSeller(null);
        setProducts([]);
        setOrders([]);
        return;
      }

      const row = sellerRow as SellerRow;
      setSeller(row);
      setBusinessName(row.business_name);
      setLogoUrl(row.logo_url ?? "");
      setCoverUrl(row.cover_image_url ?? "");
      setDocumentUrlsText(asUrlList(row.document_urls).join("\n"));

      const [{ data: productRows }, { data: orderRows }] = await Promise.all([
        supabase
          .from("seller_products")
          .select("id,title,price_cents,currency,active,stock_qty")
          .eq("seller_id", row.id)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("seller_orders")
          .select("id,status,total_cents,currency,created_at,refund_status")
          .eq("seller_id", row.id)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);

      setProducts((productRows as ProductRow[]) ?? []);
      setOrders((orderRows as OrderRow[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load seller dashboard");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!seller) return;
    setSaving(true);
    setError(null);
    try {
      const document_urls = documentUrlsText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const { error: updateError } = await supabase
        .from("sellers")
        .update({
          business_name: businessName.trim(),
          logo_url: logoUrl.trim() || null,
          cover_image_url: coverUrl.trim() || null,
          document_urls,
          updated_at: new Date().toISOString(),
        })
        .eq("id", seller.id);
      if (updateError) throw updateError;
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10 text-slate-700">
        Loading seller dashboard…
      </main>
    );
  }

  if (!seller) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-slate-900">Seller dashboard</h1>
        <p className="mt-3 text-slate-600">
          No seller profile found for this account. Create your seller profile in the
          mobile app, then return here.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-4 py-10">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Seller dashboard</h1>
        <p className="mt-1 text-slate-600">
          {seller.city} · status {seller.status}
          {seller.is_accepting_orders ? " · accepting orders" : " · paused"}
        </p>
        <p className="mt-1 text-sm text-amber-700">
          Marketplace Live money flags stay OFF. No Checkout / payouts from this page.
        </p>
      </header>

      {error ? (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <form onSubmit={saveProfile} className="space-y-3 rounded-xl border border-slate-200 p-4">
        <h2 className="font-medium text-slate-900">Profile & media</h2>
        <label className="block text-sm text-slate-700">
          Business name
          <input
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm text-slate-700">
          Logo URL
          <input
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
          />
        </label>
        <label className="block text-sm text-slate-700">
          Cover URL
          <input
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            value={coverUrl}
            onChange={(e) => setCoverUrl(e.target.value)}
          />
        </label>
        <label className="block text-sm text-slate-700">
          Document URLs (one per line)
          <textarea
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            rows={4}
            value={documentUrlsText}
            onChange={(e) => setDocumentUrlsText(e.target.value)}
            placeholder="https://…"
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save profile"}
        </button>
      </form>

      <section className="space-y-2">
        <h2 className="font-medium text-slate-900">Products ({products.length})</h2>
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
          {products.length === 0 ? (
            <li className="px-3 py-4 text-sm text-slate-500">No products yet.</li>
          ) : (
            products.map((product) => (
              <li key={product.id} className="flex justify-between gap-3 px-3 py-3 text-sm">
                <span>
                  {product.title}
                  {!product.active ? " (inactive)" : ""}
                  {product.stock_qty != null ? ` · stock ${product.stock_qty}` : ""}
                </span>
                <span>{money(product.price_cents, product.currency)}</span>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium text-slate-900">Orders ({orders.length})</h2>
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
          {orders.length === 0 ? (
            <li className="px-3 py-4 text-sm text-slate-500">No marketplace orders yet.</li>
          ) : (
            orders.map((order) => (
              <li key={order.id} className="flex justify-between gap-3 px-3 py-3 text-sm">
                <span>
                  #{order.id.slice(0, 8)} · {order.status}
                  {order.refund_status ? ` · refund ${order.refund_status}` : ""}
                </span>
                <span>{money(order.total_cents, order.currency)}</span>
              </li>
            ))
          )}
        </ul>
      </section>
    </main>
  );
}
