import { createClient } from "@supabase/supabase-js";
import AdminCancelRefundPanel from "@/components/AdminCancelRefundPanel";

type PricingRow = {
  id: string;
  config_key: string;
  label: string;
  order_type: "food" | "errand";
  active: boolean;
  client_pct: number;
  driver_pct: number;
  restaurant_pct: number;
  platform_pct: number;
  delivery_fee_base: number;
  delivery_fee_per_mile: number;
  delivery_fee_per_minute: number;
  delivery_platform_pct: number;
  delivery_driver_pct: number;
  minimum_order_amount: number;
  promo_enabled: boolean;
  promo_type: "percent" | "fixed" | "free_delivery" | null;
  promo_value: number | null;
  promo_code: string | null;
  currency: string;
  updated_at: string;
};

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

async function getPricingConfig(): Promise<PricingRow[]> {
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("pricing_config")
    .select("*")
    .order("config_key", { ascending: true });

  if (error) {
    throw new Error(`Failed to load pricing_config: ${error.message}`);
  }

  return (data ?? []) as PricingRow[];
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function numberValue(value: number | null | undefined) {
  return value ?? 0;
}

export default async function AdminPricingPage() {
  const rows = await getPricingConfig();

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Pricing Configuration</h1>
        <p className="text-sm text-gray-500">
          Modifie les commissions, promos et frais sans toucher au code.
        </p>
      </div>

      <AdminCancelRefundPanel />

      <div className="grid gap-6">
        {rows.map((row) => (
          <form
            key={row.id}
            action="/api/admin/pricing"
            method="post"
            className="rounded-2xl border p-5 shadow-sm space-y-5 bg-white"
          >
            <input type="hidden" name="id" value={row.id} />
            <input type="hidden" name="config_key" value={row.config_key} />

            <div className="space-y-1">
              <div className="text-lg font-semibold">{row.label}</div>
              <div className="text-xs text-gray-500">
                Key: {row.config_key} • Type: {row.order_type}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="space-y-1">
                <div className="text-sm font-medium">Active</div>
                <select
                  name="active"
                  defaultValue={row.active ? "true" : "false"}
                  className="w-full rounded-xl border px-3 py-2"
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </label>

              <label className="space-y-1">
                <div className="text-sm font-medium">Currency</div>
                <input
                  name="currency"
                  defaultValue={row.currency}
                  className="w-full rounded-xl border px-3 py-2"
                />
              </label>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-semibold">Core commission split</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <label className="space-y-1">
                  <div className="text-sm font-medium">Client %</div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    name="client_pct"
                    defaultValue={numberValue(row.client_pct)}
                    className="w-full rounded-xl border px-3 py-2"
                  />
                </label>

                <label className="space-y-1">
                  <div className="text-sm font-medium">Driver %</div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    name="driver_pct"
                    defaultValue={numberValue(row.driver_pct)}
                    className="w-full rounded-xl border px-3 py-2"
                  />
                </label>

                <label className="space-y-1">
                  <div className="text-sm font-medium">Restaurant %</div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    name="restaurant_pct"
                    defaultValue={numberValue(row.restaurant_pct)}
                    className="w-full rounded-xl border px-3 py-2"
                  />
                </label>

                <label className="space-y-1">
                  <div className="text-sm font-medium">Platform %</div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    name="platform_pct"
                    defaultValue={numberValue(row.platform_pct)}
                    className="w-full rounded-xl border px-3 py-2"
                  />
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-semibold">Delivery split</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="space-y-1">
                  <div className="text-sm font-medium">
                    Delivery platform %
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    name="delivery_platform_pct"
                    defaultValue={numberValue(row.delivery_platform_pct)}
                    className="w-full rounded-xl border px-3 py-2"
                  />
                </label>

                <label className="space-y-1">
                  <div className="text-sm font-medium">Delivery driver %</div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    name="delivery_driver_pct"
                    defaultValue={numberValue(row.delivery_driver_pct)}
                    className="w-full rounded-xl border px-3 py-2"
                  />
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-semibold">
                Delivery pricing inputs
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <label className="space-y-1">
                  <div className="text-sm font-medium">Delivery fee base</div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    name="delivery_fee_base"
                    defaultValue={numberValue(row.delivery_fee_base)}
                    className="w-full rounded-xl border px-3 py-2"
                  />
                </label>

                <label className="space-y-1">
                  <div className="text-sm font-medium">Per mile</div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    name="delivery_fee_per_mile"
                    defaultValue={numberValue(row.delivery_fee_per_mile)}
                    className="w-full rounded-xl border px-3 py-2"
                  />
                </label>

                <label className="space-y-1">
                  <div className="text-sm font-medium">Per minute</div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    name="delivery_fee_per_minute"
                    defaultValue={numberValue(row.delivery_fee_per_minute)}
                    className="w-full rounded-xl border px-3 py-2"
                  />
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-semibold">Order floor</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="space-y-1">
                  <div className="text-sm font-medium">
                    Minimum order amount
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    name="minimum_order_amount"
                    defaultValue={numberValue(row.minimum_order_amount)}
                    className="w-full rounded-xl border px-3 py-2"
                  />
                </label>

                <label className="space-y-1">
                  <div className="text-sm font-medium">Promo enabled</div>
                  <select
                    name="promo_enabled"
                    defaultValue={row.promo_enabled ? "true" : "false"}
                    className="w-full rounded-xl border px-3 py-2"
                  >
                    <option value="false">false</option>
                    <option value="true">true</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-semibold">Promotion</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <label className="space-y-1">
                  <div className="text-sm font-medium">Promo type</div>
                  <select
                    name="promo_type"
                    defaultValue={row.promo_type ?? ""}
                    className="w-full rounded-xl border px-3 py-2"
                  >
                    <option value="">none</option>
                    <option value="percent">percent</option>
                    <option value="fixed">fixed</option>
                    <option value="free_delivery">free_delivery</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <div className="text-sm font-medium">Promo value</div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    name="promo_value"
                    defaultValue={row.promo_value ?? ""}
                    className="w-full rounded-xl border px-3 py-2"
                  />
                </label>

                <label className="space-y-1">
                  <div className="text-sm font-medium">Promo code</div>
                  <input
                    name="promo_code"
                    defaultValue={row.promo_code ?? ""}
                    className="w-full rounded-xl border px-3 py-2"
                  />
                </label>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 pt-2">
              <div className="text-xs text-gray-500">
                Last update: {formatDateTime(row.updated_at)}
              </div>
              <button
                type="submit"
                className="rounded-xl bg-black text-white px-4 py-2 text-sm font-medium"
              >
                Save changes
              </button>
            </div>
          </form>
        ))}
      </div>
    </main>
  );
}