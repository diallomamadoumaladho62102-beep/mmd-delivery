import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "i18n", "locales");

function setDeep(obj, dotted, value) {
  const parts = dotted.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== "object") cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function get(obj, dotted) {
  return dotted.split(".").reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

const KEYS = {
  "client.newOrder.alerts.missingFieldsBody": {
    en: "Enter the pickup address and the delivery address.",
    fr: "Saisis l’adresse de retrait et l’adresse de livraison.",
    es: "Introduce la dirección de recogida y la de entrega.",
    ar: "أدخل عنوان الاستلام وعنوان التسليم.",
    zh: "请输入取餐地址和送餐地址。",
    ff: "Naatnu ñiiɓirde ƴettugol e ñiiɓirde neldol.",
  },
  "client.newOrder.errors.estimateFailed": {
    en: "Unable to calculate the delivery estimate right now.",
    fr: "Impossible de calculer l’estimation de livraison pour le moment.",
    es: "No se puede calcular la estimación de entrega ahora.",
    ar: "تعذر حساب تقدير التوصيل الآن.",
    zh: "目前无法计算配送估价。",
    ff: "Horiima hiisde ƴeewndo neldol oo sahaa.",
  },
  "client.newOrder.errors.distanceTooFarWithMiles": {
    en: "Distance is too far ({{miles}} mi). Check the address.",
    fr: "Distance trop grande ({{miles}} mi). Vérifie l’adresse.",
    es: "La distancia es demasiado grande ({{miles}} mi). Comprueba la dirección.",
    ar: "المسافة كبيرة جدًا ({{miles}} ميل). تحقق من العنوان.",
    zh: "距离过远（{{miles}} 英里）。请核对地址。",
    ff: "Woɗɗude ɓurnde ({{miles}} mi). Ƴeewto ñiiɓirde.",
  },
  "client.newOrder.alerts.distanceTooFar": {
    en: "Distance is too far.\n\nFix the address (ZIP / city / state).",
    fr: "Distance trop grande.\n\nCorrige l’adresse (code postal / ville / État).",
    es: "La distancia es demasiado grande.\n\nCorrige la dirección (ZIP / ciudad / estado).",
    ar: "المسافة كبيرة جدًا.\n\nصحّح العنوان.",
    zh: "距离过远。\n\n请修正地址。",
    ff: "Woɗɗude ɓurnde.\n\nSafru ñiiɓirde.",
  },
  "client.newOrder.alerts.fillAddressesFirst": {
    en: "Fill in the pickup and delivery addresses first.",
    fr: "Remplis d’abord les adresses de retrait et de livraison.",
    es: "Rellena primero las direcciones de recogida y entrega.",
    ar: "املأ عنواني الاستلام والتسليم أولًا.",
    zh: "请先填写取餐和送餐地址。",
    ff: "Hebbin ñiiɓirɗe ƴettugol e neldol so tawii.",
  },
  "client.newOrder.alerts.incompleteAddressCreateBody": {
    en: "Enter a complete address before continuing.",
    fr: "Saisis une adresse complète avant de continuer.",
    es: "Introduce una dirección completa antes de continuar.",
    ar: "أدخل عنوانًا كاملًا قبل المتابعة.",
    zh: "请先输入完整地址再继续。",
    ff: "Naatnu ñiiɓirde timmunde hade jokkude.",
  },
  "client.newOrder.alerts.missingOrderBody": {
    en: "Create the order first, then you can pay.",
    fr: "Crée d’abord la commande, ensuite tu pourras payer.",
    es: "Crea el pedido primero, luego podrás pagar.",
    ar: "أنشئ الطلب أولًا ثم يمكنك الدفع.",
    zh: "请先创建订单，然后才能付款。",
    ff: "Sos njamndi so tawii, ndeen a waawi yoɓde.",
  },
  "client.newOrder.errors.missingSession": {
    en: "Session expired. Sign in again and try once more.",
    fr: "Session expirée. Reconnecte-toi puis réessaie.",
    es: "La sesión expiró. Inicia sesión de nuevo e inténtalo otra vez.",
    ar: "انتهت الجلسة. سجّل الدخول ثم أعد المحاولة.",
    zh: "会话已过期。请重新登录后再试。",
    ff: "Session timmii. Naat kadi ndeen fuɗɗit.",
  },
  "client.newOrder.alerts.paymentSuccessBody": {
    en: "Thank you. Your payment is confirmed. The restaurant can now accept the order.",
    fr: "Merci. Ton paiement est confirmé. Le restaurant pourra accepter la commande.",
    es: "Gracias. Tu pago está confirmado. El restaurante ya puede aceptar el pedido.",
    ar: "شكرًا. تم تأكيد الدفع. يمكن للمطعم قبول الطلب الآن.",
    zh: "谢谢。付款已确认。餐厅现在可以接受订单。",
    ff: "A jaaraama. Njoɓdi maa jaɓaama. Restoraa waawi jaɓde njamndi jooni.",
  },
  "client.newOrder.section.estimateTitle": {
    en: "Delivery estimate (MMD Delivery)",
    fr: "Estimation de livraison (MMD Delivery)",
    es: "Estimación de entrega (MMD Delivery)",
    ar: "تقدير التوصيل (MMD Delivery)",
    zh: "配送估价（MMD Delivery）",
    ff: "Ƴeewndo neldol (MMD Delivery)",
  },
};

let added = 0;
for (const lang of ["en", "fr", "es", "ar", "zh", "ff"]) {
  const file = path.join(root, lang, "extras.json");
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const [key, map] of Object.entries(KEYS)) {
    if (get(json, key) == null) {
      setDeep(json, key, map[lang]);
      added += 1;
    }
  }
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify({ ok: true, added }));
