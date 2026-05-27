import { createClient } from "@supabase/supabase-js";
import AdminCancelRefundPanel from "@/components/AdminCancelRefundPanel";

type PricingRow = {
  id: string;
  config_key: string;
  label: string;
  order_type: "food" | "errand";
  active: boolean;
  client_pct: number | null;
  driver_pct: number | null;
  restaurant_pct: number | null;
  platform_pct: number | null;
  delivery_fee_base: number | null;
  delivery_fee_per_mile: number | null;
  delivery_fee_per_minute: number | null;
  delivery_platform_pct: number | null;
  delivery_driver_pct: number | null;
  minimum_order_amount: number | null;
  promo_enabled: boolean;
  promo_type: "percent" | "fixed" | "free_delivery" | null;
  promo_value: number | null;
  promo_code: string | null;
  currency: string | null;
  updated_at: string | null;
};

type SplitStatus = {
  total: number;
  isExact: boolean;
  isOver: boolean;
  label: string;
  tone: "ok" | "warn" | "danger";
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
    .select(
      `id, config_key, label, order_type, active, currency,
       client_pct, driver_pct, restaurant_pct, platform_pct,
       delivery_platform_pct, delivery_driver_pct,
       delivery_fee_base, delivery_fee_per_mile, delivery_fee_per_minute,
       minimum_order_amount,
       promo_enabled, promo_type, promo_value, promo_code,
       updated_at`
    )
    .order("config_key", { ascending: true });

  if (error) {
    throw new Error(`Failed to load pricing_config: ${error.message}`);
  }

  return (data ?? []) as PricingRow[];
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function numberValue(value: number | null | undefined) {
  return value ?? 0;
}

function moneyValue(value: number | null | undefined) {
  return Number(numberValue(value)).toFixed(2);
}

function pctValue(value: number | null | undefined) {
  return Number(numberValue(value)).toFixed(2).replace(/\.00$/, "");
}

function splitStatus(parts: Array<number | null | undefined>): SplitStatus {
  const total = parts.reduce((sum, value) => sum + numberValue(value), 0);
  const rounded = Math.round(total * 100) / 100;
  const isExact = Math.abs(rounded - 100) < 0.01;
  const isOver = rounded > 100;

  if (isExact) {
    return {
      total: rounded,
      isExact,
      isOver,
      label: "Balanced at 100%",
      tone: "ok",
    };
  }

  if (isOver) {
    return {
      total: rounded,
      isExact,
      isOver,
      label: `Over by ${(rounded - 100).toFixed(2)}%`,
      tone: "danger",
    };
  }

  return {
    total: rounded,
    isExact,
    isOver,
    label: `Remaining ${(100 - rounded).toFixed(2)}%`,
    tone: "warn",
  };
}

function toneClasses(tone: SplitStatus["tone"]) {
  if (tone === "ok") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (tone === "danger") {
    return "border-red-200 bg-red-50 text-red-800";
  }

  return "border-amber-200 bg-amber-50 text-amber-800";
}

function sectionTitle(title: string, subtitle: string) {
  return (
    <div className="space-y-1">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <div className="text-xs text-slate-500">{subtitle}</div>
    </div>
  );
}

function PercentInput({
  name,
  label,
  value,
  help,
}: {
  name: string;
  label: string;
  value: number | null | undefined;
  help?: string;
}) {
  return (
    <label className="space-y-1">
      <div className="text-sm font-medium text-slate-800">{label}</div>
      <div className="relative">
        <input
          type="number"
          step="0.01"
          min="0"
          max="100"
          name={name}
          defaultValue={numberValue(value)}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 pr-9 text-sm outline-none transition focus:border-black focus:ring-2 focus:ring-black/10"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">
          %
        </span>
      </div>
      {help ? <div className="text-[11px] text-slate-500">{help}</div> : null}
    </label>
  );
}

function MoneyInput({
  name,
  label,
  value,
  help,
}: {
  name: string;
  label: string;
  value: number | null | undefined;
  help?: string;
}) {
  return (
    <label className="space-y-1">
      <div className="text-sm font-medium text-slate-800">{label}</div>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">
          $
        </span>
        <input
          type="number"
          step="0.01"
          min="0"
          name={name}
          defaultValue={moneyValue(value)}
          className="w-full rounded-xl border border-slate-200 bg-white px-7 py-2 text-sm outline-none transition focus:border-black focus:ring-2 focus:ring-black/10"
        />
      </div>
      {help ? <div className="text-[11px] text-slate-500">{help}</div> : null}
    </label>
  );
}

function TextInputField({
  name,
  label,
  value,
  placeholder,
  help,
}: {
  name: string;
  label: string;
  value: string | null | undefined;
  placeholder?: string;
  help?: string;
}) {
  return (
    <label className="space-y-1">
      <div className="text-sm font-medium text-slate-800">{label}</div>
      <input
        name={name}
        defaultValue={value ?? ""}
        placeholder={placeholder}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-black focus:ring-2 focus:ring-black/10"
      />
      {help ? <div className="text-[11px] text-slate-500">{help}</div> : null}
    </label>
  );
}

function SplitSummary({
  title,
  status,
  items,
}: {
  title: string;
  status: SplitStatus;
  items: Array<{ label: string; value: number | null | undefined }>;
}) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClasses(status.tone)}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide opacity-75">
            {title}
          </div>
          <div className="mt-1 text-sm font-semibold">{status.label}</div>
        </div>
        <div className="rounded-full bg-white/70 px-3 py-1 text-sm font-black">
          Total {pctValue(status.total)}%
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="rounded-xl bg-white/60 px-3 py-2">
            <div className="text-[11px] font-semibold opacity-70">
              {item.label}
            </div>
            <div className="text-sm font-black">{pctValue(item.value)}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function AdminPricingPage() {
  const rows = await getPricingConfig();

  return (
    <main className="mx-auto max-w-6xl space-y-6 bg-slate-50 p-6 text-slate-950">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="inline-flex rounded-full bg-black px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
              MMD Delivery Admin
            </div>
            <h1 className="text-2xl font-black tracking-tight">
              Pricing Configuration
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-slate-600">
              Modifie les commissions, promotions et frais depuis Supabase
              <span className="font-semibold text-slate-900"> pricing_config</span>,
              sans toucher au code mobile. Les triggers Supabase utilisent ces
              valeurs pour calculer les gains chauffeur et la part plateforme.
            </p>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="font-bold">Règle production</div>
            <div className="mt-1 text-xs leading-5">
              Pour chaque ligne, garde le delivery split proche de 100%.
              Exemple : Driver 80% + Platform 20%.
            </div>
          </div>
        </div>
      </div>

      <AdminCancelRefundPanel />

      <div className="grid gap-6">
        {rows.map((row) => {
          const coreStatus = splitStatus([
            row.client_pct,
            row.driver_pct,
            row.restaurant_pct,
            row.platform_pct,
          ]);

          const deliveryStatus = splitStatus([
            row.delivery_driver_pct,
            row.delivery_platform_pct,
          ]);

          const isFood = row.order_type === "food";
          const isErrand = row.order_type === "errand";

          return (
            <form
              key={row.id}
              action="/api/admin/pricing"
              method="post"
              className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
            >
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="config_key" value={row.config_key} />

              <div className="border-b border-slate-100 bg-white p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-black tracking-tight">
                        {row.label}
                      </h2>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold ${
                          row.active
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {row.active ? "ACTIVE" : "INACTIVE"}
                      </span>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                        {row.order_type.toUpperCase()}
                      </span>
                    </div>

                    <div className="mt-2 text-xs text-slate-500">
                      Key: <span className="font-semibold">{row.config_key}</span>{" "}
                      • Last update: {formatDateTime(row.updated_at)}
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="rounded-2xl bg-black px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-slate-800"
                  >
                    Save changes
                  </button>
                </div>
              </div>

              <div className="grid gap-5 p-5">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label className="space-y-1">
                    <div className="text-sm font-medium text-slate-800">
                      Active
                    </div>
                    <select
                      name="active"
                      defaultValue={row.active ? "true" : "false"}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-black focus:ring-2 focus:ring-black/10"
                    >
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  </label>

                  <TextInputField
                    name="currency"
                    label="Currency"
                    value={row.currency ?? "USD"}
                    placeholder="USD"
                    help="Devise utilisée pour les montants affichés."
                  />
                </div>

                <SplitSummary
                  title="Core commission split"
                  status={coreStatus}
                  items={[
                    { label: "Client", value: row.client_pct },
                    { label: "Driver", value: row.driver_pct },
                    { label: "Restaurant", value: row.restaurant_pct },
                    { label: "Platform", value: row.platform_pct },
                  ]}
                />

                <div className="rounded-2xl border border-slate-200 p-4">
                  {sectionTitle(
                    "Core commission split",
                    isFood
                      ? "Pour food : utilisé pour la nourriture / restaurant."
                      : "Pour errand : utilisé pour les commissions générales."
                  )}

                  <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
                    <PercentInput
                      name="client_pct"
                      label="Client %"
                      value={row.client_pct}
                    />
                    <PercentInput
                      name="driver_pct"
                      label="Driver %"
                      value={row.driver_pct}
                    />
                    <PercentInput
                      name="restaurant_pct"
                      label="Restaurant %"
                      value={row.restaurant_pct}
                    />
                    <PercentInput
                      name="platform_pct"
                      label="Platform %"
                      value={row.platform_pct}
                    />
                  </div>
                </div>

                <SplitSummary
                  title="Delivery split"
                  status={deliveryStatus}
                  items={[
                    { label: "Driver", value: row.delivery_driver_pct },
                    { label: "Platform", value: row.delivery_platform_pct },
                  ]}
                />

                <div className="rounded-2xl border border-slate-200 p-4">
                  {sectionTitle(
                    "Delivery split",
                    isErrand
                      ? "Pickup/dropoff : ces % alimentent driver_delivery_payout et platform_delivery_fee."
                      : "Food delivery : ces % divisent uniquement les frais de livraison."
                  )}

                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <PercentInput
                      name="delivery_platform_pct"
                      label="Delivery platform %"
                      value={row.delivery_platform_pct}
                      help="Part plateforme sur les frais de livraison."
                    />
                    <PercentInput
                      name="delivery_driver_pct"
                      label="Delivery driver %"
                      value={row.delivery_driver_pct}
                      help="Part chauffeur affichée dans l'application driver."
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4">
                  {sectionTitle(
                    "Delivery pricing inputs",
                    "Base + distance + temps. Ces valeurs peuvent servir au calcul des frais de livraison."
                  )}

                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                    <MoneyInput
                      name="delivery_fee_base"
                      label="Delivery fee base"
                      value={row.delivery_fee_base}
                    />
                    <MoneyInput
                      name="delivery_fee_per_mile"
                      label="Per mile"
                      value={row.delivery_fee_per_mile}
                    />
                    <MoneyInput
                      name="delivery_fee_per_minute"
                      label="Per minute"
                      value={row.delivery_fee_per_minute}
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4">
                  {sectionTitle(
                    "Order floor & promotion",
                    "Contrôle du minimum de commande et des promotions actives."
                  )}

                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <MoneyInput
                      name="minimum_order_amount"
                      label="Minimum order amount"
                      value={row.minimum_order_amount}
                    />

                    <label className="space-y-1">
                      <div className="text-sm font-medium text-slate-800">
                        Promo enabled
                      </div>
                      <select
                        name="promo_enabled"
                        defaultValue={row.promo_enabled ? "true" : "false"}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-black focus:ring-2 focus:ring-black/10"
                      >
                        <option value="false">false</option>
                        <option value="true">true</option>
                      </select>
                    </label>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                    <label className="space-y-1">
                      <div className="text-sm font-medium text-slate-800">
                        Promo type
                      </div>
                      <select
                        name="promo_type"
                        defaultValue={row.promo_type ?? ""}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-black focus:ring-2 focus:ring-black/10"
                      >
                        <option value="">none</option>
                        <option value="percent">percent</option>
                        <option value="fixed">fixed</option>
                        <option value="free_delivery">free_delivery</option>
                      </select>
                    </label>

                    <MoneyInput
                      name="promo_value"
                      label="Promo value"
                      value={row.promo_value}
                    />

                    <TextInputField
                      name="promo_code"
                      label="Promo code"
                      value={row.promo_code}
                      placeholder="SAVE10"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-3 border-t border-slate-100 pt-5 md:flex-row md:items-center md:justify-between">
                  <div className="text-xs leading-5 text-slate-500">
                    Cette page écrit dans <b>pricing_config</b>. Les calculs
                    automatiques côté Supabase lisent ces valeurs pour les
                    prochaines commandes.
                  </div>

                  <button
                    type="submit"
                    className="rounded-2xl bg-black px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-slate-800"
                  >
                    Save changes
                  </button>
                </div>
              </div>
            </form>
          );
        })}
      </div>
    </main>
  );
}
