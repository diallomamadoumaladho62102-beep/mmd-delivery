/**
 * Upsert extra Admin UI catalog keys (6 locales) then regenerate TS module.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "i18n");
const catalogPath = path.join(dir, "adminUiCatalog.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));

const EXTRA = {
  "State / Region": {
    fr: "État / Région",
    es: "Estado / Región",
    ar: "الولاية / المنطقة",
    zh: "州 / 地区",
    ff: "Leydi / Diiwal",
  },
  Timezone: {
    fr: "Fuseau horaire",
    es: "Zona horaria",
    ar: "المنطقة الزمنية",
    zh: "时区",
    ff: "Waktu nokku",
  },
  Language: {
    fr: "Langue",
    es: "Idioma",
    ar: "اللغة",
    zh: "语言",
    ff: "Ɗemngal",
  },
  "Driver / Chauffeur": {
    fr: "Chauffeur",
    es: "Conductor",
    ar: "السائق",
    zh: "司机",
    ff: "Dogoowo",
  },
  "Platform / Plateforme": {
    fr: "Plateforme",
    es: "Plataforma",
    ar: "المنصة",
    zh: "平台",
    ff: "Platform",
  },
  "No messages.": {
    fr: "Aucun message.",
    es: "No hay mensajes.",
    ar: "لا توجد رسائل.",
    zh: "暂无消息。",
    ff: "Alaa mesasuuji.",
  },
  legacy: {
    fr: "ancien",
    es: "legado",
    ar: "قديم",
    zh: "旧版",
    ff: "ɗooyɗo",
  },
  Configured: {
    fr: "Configuré",
    es: "Configurado",
    ar: "مُعدّ",
    zh: "已配置",
    ff: "Yoɓaama",
  },
  Missing: {
    fr: "Manquant",
    es: "Falta",
    ar: "مفقود",
    zh: "缺失",
    ff: "Ñaawii",
  },
  "Admin Chat": {
    fr: "Chat admin",
    es: "Chat admin",
    ar: "دردشة المشرف",
    zh: "管理员聊天",
    ff: "Chat admin",
  },
  "Back to order": {
    fr: "← Retour commande",
    es: "← Volver al pedido",
    ar: "← العودة إلى الطلب",
    zh: "← 返回订单",
    ff: "← Rutto yamiroore",
  },
  "Failed to load messages.": {
    fr: "Impossible de charger les messages.",
    es: "No se pudieron cargar los mensajes.",
    ar: "تعذر تحميل الرسائل.",
    zh: "无法加载消息。",
    ff: "Waawaa loowde mesasuuji.",
  },
  "Failed to send message.": {
    fr: "Impossible d'envoyer le message.",
    es: "No se pudo enviar el mensaje.",
    ar: "تعذر إرسال الرسالة.",
    zh: "无法发送消息。",
    ff: "Waawaa neldude mesasu.",
  },
  "Missing order ID.": {
    fr: "Order ID manquant.",
    es: "Falta el ID del pedido.",
    ar: "معرّف الطلب مفقود.",
    zh: "缺少订单 ID。",
    ff: "ID yamiroore ŋaccaama.",
  },
  "Loading messages…": {
    fr: "Chargement des messages…",
    es: "Cargando mensajes…",
    ar: "جارٍ تحميل الرسائل…",
    zh: "正在加载消息…",
    ff: "Loowgol mesasuuji…",
  },
  "Type a message…": {
    fr: "Écrire un message…",
    es: "Escribe un mensaje…",
    ar: "اكتب رسالة…",
    zh: "输入消息…",
    ff: "Winndu mesasu…",
  },
  Send: {
    fr: "Envoyer",
    es: "Enviar",
    ar: "إرسال",
    zh: "发送",
    ff: "Neldu",
  },
  "Sending…": {
    fr: "Envoi…",
    es: "Enviando…",
    ar: "جارٍ الإرسال…",
    zh: "发送中…",
    ff: "Neldugol…",
  },
  "Image attached": {
    fr: "Image jointe",
    es: "Imagen adjunta",
    ar: "صورة مرفقة",
    zh: "已附加图片",
    ff: "Nataal jokkondiraa",
  },
  "Write an admin message…": {
    fr: "Écrire un message admin…",
    es: "Escribe un mensaje admin…",
    ar: "اكتب رسالة مشرف…",
    zh: "输入管理员消息…",
    ff: "Winndu mesasu admin…",
  },
  "Admin Chat →": {
    fr: "Chat admin →",
    es: "Chat admin →",
    ar: "دردشة المشرف →",
    zh: "管理员聊天 →",
    ff: "Chat admin →",
  },
  "Delivery split / Partage livraison": {
    fr: "Partage livraison",
    es: "Reparto de entrega",
    ar: "تقسيم التوصيل",
    zh: "配送分成",
    ff: "Luggondiral neldugol",
  },
  "Pickup/dropoff: used by Supabase triggers for driver_delivery_payout and platform_delivery_fee. / Pickup/dropoff : utilis?? par les triggers Supabase.": {
    fr: "Pickup/dropoff : utilisé par les triggers Supabase pour driver_delivery_payout et platform_delivery_fee.",
    es: "Pickup/dropoff: usado por triggers de Supabase para driver_delivery_payout y platform_delivery_fee.",
    ar: "الاستلام/التسليم: تستخدمه محفزات Supabase لـ driver_delivery_payout و platform_delivery_fee.",
    zh: "取件/送达：由 Supabase 触发器用于 driver_delivery_payout 与 platform_delivery_fee。",
    ff: "Pickup/dropoff: huutortee e triggers Supabase ngam driver_delivery_payout e platform_delivery_fee.",
  },
  "Food delivery: splits only the delivery fee, not the food subtotal. / Food delivery : partage seulement les frais de livraison.": {
    fr: "Livraison food : partage seulement les frais de livraison, pas le sous-total food.",
    es: "Food delivery: reparte solo la tarifa de entrega, no el subtotal de comida.",
    ar: "توصيل الطعام: يقسم رسوم التوصيل فقط وليس المجموع الفرعي للطعام.",
    zh: "餐饮配送：仅拆分配送费，不拆分餐品小计。",
    ff: "Neldugol ñamdu: lugginda tan njoɓdi neldugol, wonaa subtotal ñamdu.",
  },
};

let added = 0;
for (const [k, v] of Object.entries(EXTRA)) {
  if (!catalog[k]) added += 1;
  catalog[k] = { ...(catalog[k] || {}), ...v };
}

fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
const ts = `/* AUTO-GENERATED — do not edit by hand */
import type { WebLocale } from "@/i18n/locales";

export type AdminUiTranslation = Partial<Record<WebLocale, string>> &
  Record<Exclude<WebLocale, "en">, string>;

export const ADMIN_UI_CATALOG: Record<string, AdminUiTranslation> = ${JSON.stringify(catalog, null, 2)} as const;
`;
fs.writeFileSync(path.join(dir, "adminUiCatalog.generated.ts"), ts);
console.log(JSON.stringify({ added, total: Object.keys(catalog).length }, null, 2));
