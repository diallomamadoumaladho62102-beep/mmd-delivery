/**
 * Cancellation reason catalogs. Financial policy is not decided here.
 * "other" stores the free-text note separately from reason_code.
 */

export const CANCEL_NOTE_MIN = 8;
export const CANCEL_NOTE_MAX = 500;

export const TAXI_CLIENT_CANCEL_REASONS = [
  "driver_not_moving",
  "driver_too_late",
  "driver_concerning_behavior",
  "passenger_feels_unsafe",
  "pickup_location_problem",
  "other",
] as const;

export const TAXI_DRIVER_CANCEL_REASONS = [
  "customer_not_responding",
  "unsafe_pickup_location",
  "intoxicated_or_threatening_customer",
  "vehicle_problem",
  "emergency_or_personal_issue",
  "other",
] as const;

export const DELIVERY_CLIENT_CANCEL_REASONS = [
  "order_no_longer_needed",
  "delivery_too_long",
  "order_problem",
  "restaurant_or_seller_problem",
  "delivery_problem",
  "other",
] as const;

export const DELIVERY_DRIVER_CANCEL_REASONS = [
  "customer_not_responding",
  "delivery_location_problem",
  "safety_problem",
  "vehicle_problem",
  "emergency_or_personal_issue",
  "other",
] as const;

export const RESTAURANT_CANCEL_REASONS = [
  "cannot_prepare",
  "item_unavailable",
  "too_busy_or_closed",
  "safety_problem",
  "order_details_problem",
  "other",
] as const;

export const SELLER_CANCEL_REASONS = [
  "cannot_fulfill",
  "item_unavailable",
  "seller_unavailable",
  "safety_problem",
  "order_problem",
  "other",
] as const;

export type CancelLocale = "en" | "fr" | "es" | "ar" | "zh" | "ff";

const LABELS: Record<string, Record<CancelLocale, string>> = {
  driver_not_moving: L(
    "The driver is not heading to the pickup location",
    "Le chauffeur ne se dirige pas vers le point de prise en charge",
    "El conductor no se dirige al punto de recogida",
    "السائق لا يتجه إلى نقطة الالتقاط",
    "司机没有前往上车点",
    "Driwer yiltataako e nokku ƴettugol",
  ),
  driver_too_late: L(
    "The driver is too late",
    "Le chauffeur est trop en retard",
    "El conductor llega demasiado tarde",
    "السائق متأخر جدًا",
    "司机太晚了",
    "Driwer ina ɓooyii no feewi",
  ),
  driver_concerning_behavior: L(
    "The driver has a problem or concerning behavior",
    "Le chauffeur a un problème ou un comportement préoccupant",
    "El conductor tiene un problema o un comportamiento preocupante",
    "لدى السائق مشكلة أو سلوك مثير للقلق",
    "司机有问题或令人担心的行为",
    "Driwer ina jogii caɗeele walla jikku kulniiɗo",
  ),
  passenger_feels_unsafe: L(
    "I do not feel safe",
    "Je ne me sens pas en sécurité",
    "No me siento seguro",
    "لا أشعر بالأمان",
    "我感到不安全",
    "Mi naamnaani kisal",
  ),
  pickup_location_problem: L(
    "Problem with the pickup location",
    "Problème avec le lieu de prise en charge",
    "Problema con el punto de recogida",
    "مشكلة في موقع الالتقاط",
    "上车地点有问题",
    "Caɗeele e nokku ƴettugol",
  ),
  customer_not_responding: L(
    "The customer does not respond or is not present",
    "Le client ne répond pas ou n'est pas présent",
    "El cliente no responde o no está presente",
    "العميل لا يرد أو غير موجود",
    "客户没有回应或不在场",
    "Kelleer jaabaani walla woodaani",
  ),
  unsafe_pickup_location: L(
    "The pickup location is unsafe",
    "Le lieu de prise en charge n'est pas sûr",
    "El punto de recogida no es seguro",
    "موقع الالتقاط غير آمن",
    "上车地点不安全",
    "Nokku ƴettugol hisaani",
  ),
  intoxicated_or_threatening_customer: L(
    "The customer is intoxicated or represents a threat",
    "Le client est en état d'ébriété ou représente une menace",
    "El cliente está intoxicado o representa una amenaza",
    "العميل مخمور أو يمثل تهديدًا",
    "客户醉酒或构成威胁",
    "Kelleer ina wara walla ina hulbina",
  ),
  vehicle_problem: L(
    "Problem with the vehicle",
    "Problème avec le véhicule",
    "Problema con el vehículo",
    "مشكلة في المركبة",
    "车辆有问题",
    "Caɗeele e mootor",
  ),
  emergency_or_personal_issue: L(
    "Emergency or personal issue",
    "Urgence ou problème personnel",
    "Emergencia o asunto personal",
    "حالة طارئة أو مسألة شخصية",
    "紧急情况或个人问题",
    "Kattanɗe walla caɗeele keertiiɗe",
  ),
  order_no_longer_needed: L(
    "I no longer need the order",
    "Je n'ai plus besoin de la commande",
    "Ya no necesito el pedido",
    "لم أعد بحاجة إلى الطلب",
    "我不再需要这个订单",
    "Mi soklaani odaare ndee kadi",
  ),
  delivery_too_long: L(
    "The delivery is taking too long",
    "La livraison prend trop de temps",
    "La entrega está tardando demasiado",
    "التوصيل يستغرق وقتًا طويلًا",
    "配送时间太长",
    "Neldu ina ɓooytoo no feewi",
  ),
  order_problem: L(
    "Problem with my order",
    "Problème avec ma commande",
    "Problema con mi pedido",
    "مشكلة في طلبي",
    "我的订单有问题",
    "Caɗeele e odaare am",
  ),
  restaurant_or_seller_problem: L(
    "Problem with the restaurant or seller",
    "Problème avec le restaurant ou le vendeur",
    "Problema con el restaurante o el vendedor",
    "مشكلة في المطعم أو البائع",
    "餐厅或卖家有问题",
    "Caɗeele e restoran walla yeeyoowo",
  ),
  delivery_problem: L(
    "Problem with the delivery",
    "Problème avec la livraison",
    "Problema con la entrega",
    "مشكلة في التوصيل",
    "配送有问题",
    "Caɗeele e neldu",
  ),
  delivery_location_problem: L(
    "Problem with the delivery location",
    "Problème avec le lieu de livraison",
    "Problema con el lugar de entrega",
    "مشكلة في موقع التوصيل",
    "配送地点有问题",
    "Caɗeele e nokku neldu",
  ),
  safety_problem: L(
    "Safety problem",
    "Problème de sécurité",
    "Problema de seguridad",
    "مشكلة سلامة",
    "安全问题",
    "Caɗeele kisal",
  ),
  cannot_prepare: L(
    "Cannot prepare this order",
    "Impossible de préparer cette commande",
    "No se puede preparar este pedido",
    "لا يمكن تجهيز هذا الطلب",
    "无法制作此订单",
    "Waawaa aamde ndee odaare",
  ),
  item_unavailable: L(
    "An item is unavailable",
    "Un article n'est pas disponible",
    "Un artículo no está disponible",
    "أحد العناصر غير متوفر",
    "有商品无法提供",
    "Huunde woodaani",
  ),
  too_busy_or_closed: L(
    "The restaurant is closed or too busy",
    "Le restaurant est fermé ou trop occupé",
    "El restaurante está cerrado o demasiado ocupado",
    "المطعم مغلق أو مزدحم جدًا",
    "餐厅已打烊或太忙",
    "Restoran uddii walla ina heewi golle",
  ),
  order_details_problem: L(
    "Problem with the order",
    "Problème avec la commande",
    "Problema con el pedido",
    "مشكلة في الطلب",
    "订单有问题",
    "Caɗeele e odaare",
  ),
  cannot_fulfill: L(
    "Cannot fulfill this order",
    "Impossible d'honorer cette commande",
    "No se puede cumplir este pedido",
    "لا يمكن تنفيذ هذا الطلب",
    "无法完成此订单",
    "Waawaa huutoraade ndee odaare",
  ),
  seller_unavailable: L(
    "The seller is unavailable",
    "Le vendeur n'est pas disponible",
    "El vendedor no está disponible",
    "البائع غير متاح",
    "卖家无法接单",
    "Yeeyoowo woodaani",
  ),
  other: L(
    "Other — explain your reason",
    "Autre — expliquez votre raison",
    "Otro — explica tu motivo",
    "أخرى — اشرح سببك",
    "其他 — 请说明原因",
    "Woɗɗude — siftin daliilu maa",
  ),
};

function L(
  en: string,
  fr: string,
  es: string,
  ar: string,
  zh: string,
  ff: string,
): Record<CancelLocale, string> {
  return { en, fr, es, ar, zh, ff };
}

export function cancellationReasonLabel(code: string, locale: CancelLocale = "en"): string {
  const row = LABELS[code];
  if (!row) return code;
  return row[locale] ?? row.en;
}

export function normalizeCancelReasonCode(
  value: unknown,
  allowed: readonly string[],
): string | null {
  const code = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .slice(0, 64);
  if (!code || !allowed.includes(code)) return null;
  return code;
}

export function parseCancellationNote(
  value: unknown,
  required: boolean,
): { ok: true; note: string | null } | { ok: false; error: "cancel_reason_detail_required" } {
  const note = String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, CANCEL_NOTE_MAX);
  if (required && note.length < CANCEL_NOTE_MIN) {
    return { ok: false, error: "cancel_reason_detail_required" };
  }
  return { ok: true, note: note.length > 0 ? note : null };
}

export function parseStructuredCancelReason(
  input: { reasonCode: unknown; reasonNote: unknown },
  allowed: readonly string[],
):
  | { ok: true; reasonCode: string; reasonNote: string | null }
  | { ok: false; error: "cancel_reason_required" | "cancel_reason_detail_required"; allowed: readonly string[] } {
  const reasonCode = normalizeCancelReasonCode(input.reasonCode, allowed);
  if (!reasonCode) {
    return { ok: false, error: "cancel_reason_required", allowed };
  }
  const note = parseCancellationNote(input.reasonNote, reasonCode === "other");
  if (note.ok === false) {
    return { ok: false, error: note.error, allowed };
  }
  return { ok: true, reasonCode, reasonNote: note.note };
}

/** Customer-facing copy must not repeat a safety-sensitive driver reason. */
export function customerSafeCancelCode(reasonCode: string): string {
  if (reasonCode === "intoxicated_or_threatening_customer") return "driver_released";
  return reasonCode;
}
