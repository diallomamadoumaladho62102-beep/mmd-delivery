/**
 * Fill missing locale keys from English (common+extras) so non-EN bundles
 * don't rely on silent English fallback for keys that exist only in en/extras.
 * Critical keys get proper translations; others copy EN as temporary fill.
 *
 * Run: node apps/mobile/scripts/sync-missing-locale-keys.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(__dirname, "..", "src", "i18n", "locales");
const LANGS = ["fr", "es", "ar", "zh", "ff"];

function isObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function deepMerge(base, override) {
  if (!isObject(base)) return override ?? base;
  const out = { ...base };
  if (!isObject(override)) return out;
  for (const k of Object.keys(override)) {
    const bv = out[k];
    const ov = override[k];
    if (isObject(bv) && isObject(ov)) out[k] = deepMerge(bv, ov);
    else out[k] = ov;
  }
  return out;
}

function setDeep(obj, dotted, value) {
  const parts = dotted.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!isObject(cur[p])) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function getDeep(obj, dotted) {
  let cur = obj;
  for (const p of dotted.split(".")) {
    if (!isObject(cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

function flatten(obj, prefix = "", out = {}) {
  if (!isObject(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${k}` : k;
    if (isObject(v)) flatten(v, next, out);
    else if (typeof v === "string") out[next] = v;
  }
  return out;
}

const overrides = {
  fr: {
    "roleSelect.browseMarketplace": "Parcourir le Marketplace",
    "roleSelect.browseMarketplaceHint":
      "Aucun compte requis pour découvrir les produits",
    "roleSelect.taglineHeart": "On livre avec le cœur",
    "roleSelect.taglineModes": "Taxi • Livraison • Business",
    "roleSelect.taglineFast": "Rapide, simple et fiable",
    "roleSelect.advantages.secure": "Paiements sécurisés",
    "roleSelect.advantages.fast": "Livraison rapide",
    "roleSelect.advantages.tracking": "Suivi en direct",
    "roleSelect.advantages.support": "Support 24/7",
    "restaurant.wallet.title": "Portefeuille restaurant",
    "restaurant.wallet.available": "Disponible",
    "restaurant.wallet.awaiting": "En attente",
    "restaurant.wallet.paidOut": "Payé",
    "restaurant.wallet.history": "Historique",
    "restaurant.wallet.loadFailed": "Impossible de charger le portefeuille.",
    "restaurant.wallet.emptyTitle": "Aucune transaction",
    "restaurant.wallet.emptyBody": "Les mouvements apparaîtront ici.",
  },
  es: {
    "roleSelect.browseMarketplace": "Explorar Marketplace",
    "roleSelect.browseMarketplaceHint":
      "No se necesita cuenta para descubrir productos",
    "roleSelect.taglineHeart": "Entregamos con el corazón",
    "roleSelect.taglineModes": "Taxi • Entrega • Negocios",
    "roleSelect.taglineFast": "Rápido, simple y confiable",
    "roleSelect.advantages.secure": "Pagos seguros",
    "roleSelect.advantages.fast": "Entrega rápida",
    "roleSelect.advantages.tracking": "Seguimiento en vivo",
    "roleSelect.advantages.support": "Soporte 24/7",
    "restaurant.wallet.title": "Billetera del restaurante",
    "restaurant.wallet.available": "Disponible",
    "restaurant.wallet.awaiting": "Pendiente",
    "restaurant.wallet.paidOut": "Pagado",
    "restaurant.wallet.history": "Historial",
    "restaurant.wallet.loadFailed": "No se pudo cargar la billetera.",
    "restaurant.wallet.emptyTitle": "Sin transacciones",
    "restaurant.wallet.emptyBody": "Los movimientos aparecerán aquí.",
  },
  ar: {
    "roleSelect.browseMarketplace": "تصفح السوق",
    "roleSelect.browseMarketplaceHint": "لا حاجة لحساب لاكتشاف المنتجات",
    "roleSelect.taglineHeart": "نوصل بقلب",
    "roleSelect.taglineModes": "تاكسي • توصيل • أعمال",
    "roleSelect.taglineFast": "سريع وبسيط وموثوق",
    "roleSelect.advantages.secure": "مدفوعات آمنة",
    "roleSelect.advantages.fast": "توصيل سريع",
    "roleSelect.advantages.tracking": "تتبع مباشر",
    "roleSelect.advantages.support": "دعم على مدار الساعة",
    "restaurant.wallet.title": "محفظة المطعم",
    "restaurant.wallet.available": "المتاح",
    "restaurant.wallet.awaiting": "قيد الانتظار",
    "restaurant.wallet.paidOut": "مدفوع",
    "restaurant.wallet.history": "السجل",
    "restaurant.wallet.loadFailed": "تعذر تحميل المحفظة.",
    "restaurant.wallet.emptyTitle": "لا توجد معاملات",
    "restaurant.wallet.emptyBody": "ستظهر الحركات هنا.",
  },
  zh: {
    "roleSelect.browseMarketplace": "浏览商城",
    "roleSelect.browseMarketplaceHint": "浏览商品无需账户",
    "roleSelect.taglineHeart": "用心送达",
    "roleSelect.taglineModes": "出租车 • 配送 • 商务",
    "roleSelect.taglineFast": "快速、简单、可靠",
    "roleSelect.advantages.secure": "安全支付",
    "roleSelect.advantages.fast": "快速配送",
    "roleSelect.advantages.tracking": "实时追踪",
    "roleSelect.advantages.support": "全天候支持",
    "restaurant.wallet.title": "餐厅钱包",
    "restaurant.wallet.available": "可用",
    "restaurant.wallet.awaiting": "待结算",
    "restaurant.wallet.paidOut": "已支付",
    "restaurant.wallet.history": "历史",
    "restaurant.wallet.loadFailed": "无法加载钱包。",
    "restaurant.wallet.emptyTitle": "暂无交易",
    "restaurant.wallet.emptyBody": "资金变动将显示在这里。",
  },
  ff: {
    "roleSelect.browseMarketplace": "Yiytu Marketplace",
    "roleSelect.browseMarketplaceHint": "Alaa konte haaje ngam yiytude peewnugol",
    "roleSelect.taglineHeart": "Min neldii e ɓernde",
    "roleSelect.taglineModes": "Taxi • Neldugol • Njulaagu",
    "roleSelect.taglineFast": "Jaawɗum, weeɓi, hoolniiɗum",
    "roleSelect.advantages.secure": "Njoɓɗi kisal",
    "roleSelect.advantages.fast": "Neldugol jaawngol",
    "roleSelect.advantages.tracking": "Rewindowgol e sahaa",
    "roleSelect.advantages.support": "Ballal 24/7",
    "restaurant.wallet.title": "Wallet restoraa",
    "restaurant.wallet.available": "Woodi",
    "restaurant.wallet.awaiting": "Nana ñaaɗi",
    "restaurant.wallet.paidOut": "Yoɓaama",
    "restaurant.wallet.history": "Daartol",
    "restaurant.wallet.loadFailed": "Waawaa loowde wallet.",
    "restaurant.wallet.emptyTitle": "Alaa njoɓɗi",
    "restaurant.wallet.emptyBody": "Dilleelji kollirtee ɗoo.",
  },
};

const enCommon = JSON.parse(
  fs.readFileSync(path.join(localesDir, "en", "common.json"), "utf8"),
);
const enExtras = JSON.parse(
  fs.readFileSync(path.join(localesDir, "en", "extras.json"), "utf8"),
);
const enFlat = flatten(deepMerge(enCommon, enExtras));

for (const lang of LANGS) {
  const commonPath = path.join(localesDir, lang, "common.json");
  const extrasPath = path.join(localesDir, lang, "extras.json");
  const common = JSON.parse(fs.readFileSync(commonPath, "utf8"));
  const extras = JSON.parse(fs.readFileSync(extrasPath, "utf8"));
  const merged = flatten(deepMerge(deepMerge(enCommon, common), extras));

  const missing = Object.keys(enFlat).filter((k) => !(merged[k] || "").trim());
  let filled = 0;
  for (const key of missing) {
    const value = overrides[lang]?.[key] ?? enFlat[key];
    // Prefer writing into extras for product keys, common for common.* only
    const target = key.startsWith("common.") ? common : extras;
    if (typeof getDeep(target, key) !== "string") {
      setDeep(target, key, value);
      filled += 1;
    }
  }

  fs.writeFileSync(commonPath, `${JSON.stringify(common, null, 2)}\n`, "utf8");
  fs.writeFileSync(extrasPath, `${JSON.stringify(extras, null, 2)}\n`, "utf8");
  console.log(`${lang}: filled ${filled} missing keys (of ${missing.length})`);
}

console.log("sync-missing-locale-keys done");
