import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import AdminCancelRefundPanel from "@/components/AdminCancelRefundPanel";
import AdminPricingHistory from "@/components/admin/AdminPricingHistory";
import { canModifyPricing } from "@/lib/adminAccess";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { requirePricingPageAccess } from "@/lib/adminPageAuth";
import { normalizeUserRole } from "@/lib/roles";
import { supabaseServer } from "@/lib/supabaseServer";

const PRICING_PAGE_PATH = "/admin/pricing";
const MAX_MONEY_VALUE = 1_000_000;
const ALLOWED_PROMO_TYPES = new Set(["percent", "fixed", "free_delivery"]);

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
  promo_starts_at: string | null;
  promo_ends_at: string | null;
  region: "global" | "us" | "africa" | null;
  tax_enabled: boolean;
  tax_pct: number | null;
  tax_label: string | null;
  fixed_client_fee: number | null;
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

type PromoType = "percent" | "fixed" | "free_delivery" | null;

type PricingPayload = {
  active: boolean;
  currency: string;
  client_pct: number;
  driver_pct: number;
  restaurant_pct: number;
  platform_pct: number;
  delivery_platform_pct: number;
  delivery_driver_pct: number;
  delivery_fee_base: number;
  delivery_fee_per_mile: number;
  delivery_fee_per_minute: number;
  minimum_order_amount: number;
  promo_enabled: boolean;
  promo_type: PromoType;
  promo_value: number | null;
  promo_code: string | null;
  promo_starts_at: string | null;
  promo_ends_at: string | null;
  region: "global" | "us" | "africa";
  tax_enabled: boolean;
  tax_pct: number;
  tax_label: string | null;
  fixed_client_fee: number;
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
    .select(
      `id, config_key, label, order_type, active, currency,
       client_pct, driver_pct, restaurant_pct, platform_pct,
       delivery_platform_pct, delivery_driver_pct,
       delivery_fee_base, delivery_fee_per_mile, delivery_fee_per_minute,
       minimum_order_amount,
       promo_enabled, promo_type, promo_value, promo_code,
       promo_starts_at, promo_ends_at,
       region, tax_enabled, tax_pct, tax_label, fixed_client_fee,
       updated_at`
    )
    .order("config_key", { ascending: true });

  if (error) {
    throw new Error(`Failed to load pricing_config: ${error.message}`);
  }

  return (data ?? []) as PricingRow[];
}

function text(value: FormDataEntryValue | null, fallback = "") {
  return String(value ?? fallback).trim();
}

function nullableText(value: FormDataEntryValue | null) {
  const clean = text(value);
  return clean ? clean : null;
}

function bool(value: FormDataEntryValue | null) {
  const clean = text(value).toLowerCase();
  return clean === "true" || clean === "1" || clean === "on" || clean === "yes";
}

function parseNumber(value: FormDataEntryValue | null, fallback = 0) {
  const clean = text(value).replace(",", ".");
  if (!clean) return fallback;

  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNullableNumber(value: FormDataEntryValue | null) {
  const clean = text(value).replace(",", ".");
  if (!clean) return null;

  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : null;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function assertUuid(value: string) {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidPattern.test(value)) {
    throw new Error("Invalid pricing config ID / ID de configuration invalide.");
  }
}

function assertPercent(name: string, value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${name} must be between 0 and 100 / doit être entre 0 et 100.`);
  }
}

function assertMoney(name: string, value: number) {
  if (!Number.isFinite(value) || value < 0 || value > MAX_MONEY_VALUE) {
    throw new Error(
      `${name} must be between 0 and ${MAX_MONEY_VALUE} / doit être entre 0 et ${MAX_MONEY_VALUE}.`
    );
  }
}

function normalizeCurrency(value: string) {
  const currency = value.trim().toUpperCase() || "USD";

  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Currency must be a 3-letter code like USD / La devise doit être un code de 3 lettres comme USD.");
  }

  return currency;
}

function normalizePromoType(value: string | null): PromoType {
  if (!value) return null;

  const promoType = value.trim().toLowerCase();
  if (!ALLOWED_PROMO_TYPES.has(promoType)) {
    throw new Error("Invalid promo type / Type de promotion invalide.");
  }

  return promoType as PromoType;
}

function normalizePromoCode(value: string | null) {
  if (!value) return null;

  const promo = value.trim().toUpperCase().replace(/\s+/g, "");
  if (!promo) return null;

  if (!/^[A-Z0-9_-]{3,32}$/.test(promo)) {
    throw new Error(
      "Promo code must be 3-32 characters: A-Z, 0-9, _ or - / Code promo : 3 à 32 caractères."
    );
  }

  return promo;
}

function buildPayload(formData: FormData): { id: string; payload: PricingPayload } {
  const id = text(formData.get("id"));
  if (!id) throw new Error("Missing ID / ID manquant.");
  assertUuid(id);

  const active = bool(formData.get("active"));
  const promoEnabled = bool(formData.get("promo_enabled"));

  const clientPct = round2(parseNumber(formData.get("client_pct")));
  // Production rule:
  // The driver must not take a percentage from the food/order subtotal.
  // Driver payout is calculated only from delivery_driver_pct on the transport/delivery fee.
  const driverPct = 0;
  const restaurantPct = round2(parseNumber(formData.get("restaurant_pct")));
  const platformPct = round2(parseNumber(formData.get("platform_pct")));

  const deliveryPlatformPct = round2(
    parseNumber(formData.get("delivery_platform_pct"), 20)
  );
  const deliveryDriverPct = round2(
    parseNumber(formData.get("delivery_driver_pct"), 80)
  );

  const deliveryFeeBase = round2(parseNumber(formData.get("delivery_fee_base")));
  const deliveryFeePerMile = round2(
    parseNumber(formData.get("delivery_fee_per_mile"))
  );
  const deliveryFeePerMinute = round2(
    parseNumber(formData.get("delivery_fee_per_minute"))
  );
  const minimumOrderAmount = round2(
    parseNumber(formData.get("minimum_order_amount"))
  );

  const promoType = normalizePromoType(nullableText(formData.get("promo_type")));
  const promoValue = parseNullableNumber(formData.get("promo_value"));
  const promoCode = normalizePromoCode(nullableText(formData.get("promo_code")));
  const promoStartsAt = nullableText(formData.get("promo_starts_at"));
  const promoEndsAt = nullableText(formData.get("promo_ends_at"));
  const regionRaw = text(formData.get("region"), "global").toLowerCase();
  const region =
    regionRaw === "us" || regionRaw === "africa" || regionRaw === "global"
      ? regionRaw
      : "global";
  const taxEnabled = bool(formData.get("tax_enabled"));
  const taxPct = round2(parseNumber(formData.get("tax_pct")));
  const taxLabel = nullableText(formData.get("tax_label"));
  const fixedClientFee = round2(parseNumber(formData.get("fixed_client_fee")));
  const currency = normalizeCurrency(text(formData.get("currency"), "USD"));

  assertPercent("client_pct", clientPct);
  assertPercent("driver_pct", driverPct);
  assertPercent("restaurant_pct", restaurantPct);
  assertPercent("platform_pct", platformPct);
  assertPercent("delivery_platform_pct", deliveryPlatformPct);
  assertPercent("delivery_driver_pct", deliveryDriverPct);

  assertMoney("delivery_fee_base", deliveryFeeBase);
  assertMoney("delivery_fee_per_mile", deliveryFeePerMile);
  assertMoney("delivery_fee_per_minute", deliveryFeePerMinute);
  assertMoney("minimum_order_amount", minimumOrderAmount);
  assertMoney("fixed_client_fee", fixedClientFee);
  assertPercent("tax_pct", taxPct);

  const deliveryTotal = round2(deliveryDriverPct + deliveryPlatformPct);
  if (deliveryTotal !== 100) {
    throw new Error(
      "Delivery driver % + delivery platform % must equal 100 / La livraison chauffeur % + plateforme % doit faire 100."
    );
  }

  const coreTotal = round2(clientPct + restaurantPct + platformPct);
  if (coreTotal > 100) {
    throw new Error(
      "Client % + Restaurant % + Platform % must be <= 100 / Client % + Restaurant % + Plateforme % doit être <= 100."
    );
  }

  if (promoEnabled) {
    if (!promoType) {
      throw new Error("Promo type is required when promo is enabled / Type promo obligatoire si la promo est active.");
    }

    if (promoType !== "free_delivery" && promoValue === null) {
      throw new Error("Promo value is required / Valeur promo obligatoire.");
    }

    if (promoValue !== null) {
      const safePromoValue = round2(promoValue);
      if (!Number.isFinite(safePromoValue) || safePromoValue < 0) {
        throw new Error("Promo value must be >= 0 / Valeur promo doit être >= 0.");
      }

      if (promoType === "percent" && safePromoValue > 100) {
        throw new Error("Percent promo must be <= 100 / Promo pourcentage doit être <= 100.");
      }
    }
  }

  return {
    id,
    payload: {
      active,
      currency,
      client_pct: clientPct,
      driver_pct: driverPct,
      restaurant_pct: restaurantPct,
      platform_pct: platformPct,
      delivery_platform_pct: deliveryPlatformPct,
      delivery_driver_pct: deliveryDriverPct,
      delivery_fee_base: deliveryFeeBase,
      delivery_fee_per_mile: deliveryFeePerMile,
      delivery_fee_per_minute: deliveryFeePerMinute,
      minimum_order_amount: minimumOrderAmount,
      promo_enabled: promoEnabled,
      promo_type: promoEnabled ? promoType : null,
      promo_value:
        promoEnabled && promoType !== "free_delivery" && promoValue !== null
          ? round2(promoValue)
          : null,
      promo_code: promoEnabled ? promoCode : null,
      promo_starts_at: promoEnabled ? promoStartsAt : null,
      promo_ends_at: promoEnabled ? promoEndsAt : null,
      region,
      tax_enabled: taxEnabled,
      tax_pct: taxPct,
      tax_label: taxLabel,
      fixed_client_fee: fixedClientFee,
      updated_at: new Date().toISOString(),
    },
  };
}

async function updatePricingConfig(formData: FormData) {
  "use server";

  const session = await supabaseServer();
  const {
    data: { user },
  } = await session.auth.getUser();

  if (!user) throw new Error("Unauthorized");

  const supabase = getAdminClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const role = normalizeUserRole(profile?.role);
  if (!canModifyPricing(role)) throw new Error("Forbidden");

  const { id, payload } = buildPayload(formData);

  const { data: before, error: readErr } = await supabase
    .from("pricing_config")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (readErr || !before) {
    throw new Error("pricing_config row not found");
  }

  const { error } = await supabase
    .from("pricing_config")
    .update(payload)
    .eq("id", id);

  if (error) {
    throw new Error(`Failed to save pricing_config / Échec sauvegarde pricing_config: ${error.message}`);
  }

  await supabase.from("pricing_config_history").insert({
    pricing_config_id: id,
    changed_by: user.id,
    old_values: before,
    new_values: payload,
    change_type: "update",
  });

  await writeAdminAuditServer({
    supabaseAdmin: supabase,
    adminUserId: user.id,
    action: "pricing_updated",
    targetType: "pricing_config",
    targetId: id,
    oldValues: before as Record<string, unknown>,
    newValues: payload as unknown as Record<string, unknown>,
  });

  revalidatePath(PRICING_PAGE_PATH);
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
  const rounded = round2(total);
  const isExact = Math.abs(rounded - 100) < 0.01;
  const isOver = rounded > 100;

  if (isExact) {
    return {
      total: rounded,
      isExact,
      isOver,
      label: "Balanced at 100% / Équilibré à 100%",
      tone: "ok",
    };
  }

  if (isOver) {
    return {
      total: rounded,
      isExact,
      isOver,
      label: `Over by ${(rounded - 100).toFixed(2)}% / Dépasse de ${(rounded - 100).toFixed(2)}%`,
      tone: "danger",
    };
  }

  return {
    total: rounded,
    isExact,
    isOver,
    label: `Remaining ${(100 - rounded).toFixed(2)}% / Reste ${(100 - rounded).toFixed(2)}%`,
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
      <div className="text-xs leading-5 text-slate-500">{subtitle}</div>
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
      {help ? <div className="text-[11px] leading-4 text-slate-500">{help}</div> : null}
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
      {help ? <div className="text-[11px] leading-4 text-slate-500">{help}</div> : null}
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
      {help ? <div className="text-[11px] leading-4 text-slate-500">{help}</div> : null}
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
  const { canWrite } = await requirePricingPageAccess();
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
              Pricing Configuration / Configuration des prix
            </h1>
            <p className="max-w-3xl text-sm leading-6 text-slate-600">
              Edit commissions, promotions, delivery pricing and payout splits from
              <span className="font-semibold text-slate-900"> Supabase pricing_config</span>{" "}
              without changing the mobile app code. / Modifie les commissions,
              promotions, frais et partages depuis{" "}
              <span className="font-semibold text-slate-900">Supabase pricing_config</span>{" "}
              sans toucher au code mobile.
            </p>
            {!canWrite ? (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                Mode lecture seule — seul le Super Admin peut modifier le pricing.
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="font-bold">Production rule / Règle production</div>
            <div className="mt-1 text-xs leading-5">
              Delivery driver % + delivery platform % must equal 100. The driver gets paid only from transport/delivery, not from the order subtotal. / La part chauffeur livraison + la part plateforme livraison doit faire 100. Le chauffeur est payé seulement sur le transport/livraison, pas sur le montant de la commande.
            </div>
          </div>
        </div>
      </div>

      <AdminCancelRefundPanel />

      <div className="grid gap-6">
        {rows.map((row) => {
          const coreStatus = splitStatus([
            row.client_pct,
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
              action={canWrite ? updatePricingConfig : undefined}
              className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
            >
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="config_key" value={row.config_key} />

              <fieldset disabled={!canWrite} className="disabled:opacity-80">
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
                      • Last update / Dernière mise à jour:{" "}
                      {formatDateTime(row.updated_at)}
                    </div>
                  </div>

                  {canWrite ? (
                    <button
                      type="submit"
                      className="rounded-2xl bg-black px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-slate-800"
                    >
                      Save changes / Enregistrer
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-5 p-5">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label className="space-y-1">
                    <div className="text-sm font-medium text-slate-800">
                      Active / Actif
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
                    label="Currency / Devise"
                    value={row.currency ?? "USD"}
                    placeholder="USD"
                    help="3-letter currency code. / Code devise à 3 lettres."
                  />
                </div>

                <SplitSummary
                  title="Core split / Partage principal"
                  status={coreStatus}
                  items={[
                    { label: "Client", value: row.client_pct },
                    { label: "Restaurant", value: row.restaurant_pct },
                    { label: "Platform", value: row.platform_pct },
                  ]}
                />

                <div className="rounded-2xl border border-slate-200 p-4">
                  {sectionTitle(
                    "Core commission split / Partage commission principale",
                    isFood
                      ? "Food: restaurant subtotal split only. Suggested: Restaurant 85%, Platform 15%, Driver 0%. / Food : partage nourriture seulement. Recommandé : Restaurant 85%, Plateforme 15%, Chauffeur 0%."
                      : "Errand: no driver percentage on order money. Driver is paid from delivery/transport split below. / Errand : pas de % chauffeur sur la commande. Le chauffeur est payé via le transport ci-dessous."
                  )}

                  <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
                    <PercentInput
                      name="client_pct"
                      label="Client %"
                      value={row.client_pct}
                    />
                    <input type="hidden" name="driver_pct" value="0" />
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="text-sm font-medium text-slate-800">
                        Driver order % / Chauffeur commande %
                      </div>
                      <div className="mt-2 text-lg font-black text-slate-900">0%</div>
                      <div className="mt-1 text-[11px] leading-4 text-slate-500">
                        Not used for order/subtotal commissions. Driver earnings are calculated only from the delivery/transport split below. / Non utilisé sur l’argent de la commande. Le chauffeur est payé seulement avec le partage livraison/transport ci-dessous.
                      </div>
                    </div>
                    <PercentInput
                      name="restaurant_pct"
                      label="Restaurant %"
                      value={row.restaurant_pct}
                    />
                    <PercentInput
                      name="platform_pct"
                      label="Platform % / Plateforme %"
                      value={row.platform_pct}
                    />
                  </div>
                </div>

                <SplitSummary
                  title="Delivery split / Partage livraison"
                  status={deliveryStatus}
                  items={[
                    { label: "Driver / Chauffeur", value: row.delivery_driver_pct },
                    { label: "Platform / Plateforme", value: row.delivery_platform_pct },
                  ]}
                />

                <div className="rounded-2xl border border-slate-200 p-4">
                  {sectionTitle(
                    "Delivery split / Partage livraison",
                    isErrand
                      ? "Pickup/dropoff: used by Supabase triggers for driver_delivery_payout and platform_delivery_fee. / Pickup/dropoff : utilisé par les triggers Supabase."
                      : "Food delivery: splits only the delivery fee, not the food subtotal. / Food delivery : partage seulement les frais de livraison."
                  )}

                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <PercentInput
                      name="delivery_platform_pct"
                      label="Delivery platform % / Plateforme livraison %"
                      value={row.delivery_platform_pct}
                      help="Platform share on delivery fee. / Part plateforme sur les frais de livraison."
                    />
                    <PercentInput
                      name="delivery_driver_pct"
                      label="Delivery driver % / Chauffeur livraison %"
                      value={row.delivery_driver_pct}
                      help="Driver payout shown in the driver app. / Gain chauffeur affiché dans l’app."
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4">
                  {sectionTitle(
                    "Delivery pricing inputs / Paramètres prix livraison",
                    "Base + distance + time. / Base + distance + temps."
                  )}

                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                    <MoneyInput
                      name="delivery_fee_base"
                      label="Delivery fee base / Base livraison"
                      value={row.delivery_fee_base}
                    />
                    <MoneyInput
                      name="delivery_fee_per_mile"
                      label="Per mile / Par mile"
                      value={row.delivery_fee_per_mile}
                    />
                    <MoneyInput
                      name="delivery_fee_per_minute"
                      label="Per minute / Par minute"
                      value={row.delivery_fee_per_minute}
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4">
                  {sectionTitle(
                    "Order floor & promotion / Minimum commande & promotion",
                    "Control minimum order amount and active promotions. / Contrôle du minimum et des promotions."
                  )}

                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <MoneyInput
                      name="minimum_order_amount"
                      label="Minimum order amount / Montant minimum"
                      value={row.minimum_order_amount}
                    />

                    <label className="space-y-1">
                      <div className="text-sm font-medium text-slate-800">
                        Promo enabled / Promo active
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
                        Promo type / Type promo
                      </div>
                      <select
                        name="promo_type"
                        defaultValue={row.promo_type ?? ""}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-black focus:ring-2 focus:ring-black/10"
                      >
                        <option value="">none / aucun</option>
                        <option value="percent">percent / pourcentage</option>
                        <option value="fixed">fixed / montant fixe</option>
                        <option value="free_delivery">
                          free_delivery / livraison gratuite
                        </option>
                      </select>
                    </label>

                    <MoneyInput
                      name="promo_value"
                      label="Promo value / Valeur promo"
                      value={row.promo_value}
                    />

                    <TextInputField
                      name="promo_code"
                      label="Promo code / Code promo"
                      value={row.promo_code}
                      placeholder="SAVE10"
                    />
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <TextInputField
                      name="promo_starts_at"
                      label="Promo starts (ISO) / Début promo"
                      value={row.promo_starts_at}
                      placeholder="2026-07-01T00:00:00Z"
                    />
                    <TextInputField
                      name="promo_ends_at"
                      label="Promo ends (ISO) / Fin promo"
                      value={row.promo_ends_at}
                      placeholder="2026-12-31T23:59:59Z"
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4">
                  {sectionTitle(
                    "Region & taxes / Région & taxes",
                    "US, Africa or global — editable without redeploy. / US, Afrique ou global."
                  )}
                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <label className="space-y-1">
                      <div className="text-sm font-medium text-slate-800">Region</div>
                      <select
                        name="region"
                        defaultValue={row.region ?? "global"}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      >
                        <option value="global">global</option>
                        <option value="us">us</option>
                        <option value="africa">africa</option>
                      </select>
                    </label>
                    <MoneyInput
                      name="fixed_client_fee"
                      label="Fixed client fee / Frais fixe client"
                      value={row.fixed_client_fee}
                    />
                    <label className="space-y-1">
                      <div className="text-sm font-medium text-slate-800">Tax enabled</div>
                      <select
                        name="tax_enabled"
                        defaultValue={row.tax_enabled ? "true" : "false"}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      >
                        <option value="false">false</option>
                        <option value="true">true</option>
                      </select>
                    </label>
                    <PercentInput
                      name="tax_pct"
                      label="Tax % / Taxe %"
                      value={row.tax_pct}
                    />
                    <TextInputField
                      name="tax_label"
                      label="Tax label / Libellé taxe"
                      value={row.tax_label}
                      placeholder="Sales tax / TVA"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-3 border-t border-slate-100 pt-5 md:flex-row md:items-center md:justify-between">
                  <div className="text-xs leading-5 text-slate-500">
                    This page writes directly to <b>pricing_config</b>. Supabase
                    triggers read these values for the next orders. / Cette page
                    écrit directement dans <b>pricing_config</b>. Les triggers
                    Supabase lisent ces valeurs pour les prochaines commandes.
                  </div>

                  {canWrite ? (
                    <button
                      type="submit"
                      className="rounded-2xl bg-black px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-slate-800"
                    >
                      Save changes / Enregistrer
                    </button>
                  ) : null}
                </div>
              </div>
              </fieldset>
            </form>
          );
        })}
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">
          Historique pricing & rollback
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Toutes les modifications et restaurations de versions précédentes.
        </p>
        <div className="mt-4">
          <AdminPricingHistory canRollback={canWrite} />
        </div>
      </section>
    </main>
  );
}