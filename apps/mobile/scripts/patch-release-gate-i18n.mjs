/**
 * Patch release-gate i18n keys into all 6 locale packs.
 * Run: node scripts/patch-release-gate-i18n.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "i18n", "locales");

const KEYS = {
  "restaurant.automation.title": {
    en: "Order Automation",
    fr: "Automatisation des commandes",
    es: "Automatización de pedidos",
    ar: "أتمتة الطلبات",
    zh: "订单自动化",
    ff: "Otomatisaasiyoŋ yamirooje",
  },
  "restaurant.automation.subtitle": {
    en: "Settings",
    fr: "Paramètres",
    es: "Ajustes",
    ar: "الإعدادات",
    zh: "设置",
    ff: "Teelte",
  },
  "restaurant.automation.loadingTitle": {
    en: "Loading Settings...",
    fr: "Chargement des paramètres...",
    es: "Cargando ajustes...",
    ar: "جاري تحميل الإعدادات...",
    zh: "正在加载设置…",
    ff: "Loowgol teelte...",
  },
  "restaurant.automation.loadingSubtitle": {
    en: "Fetching your automation preferences",
    fr: "Récupération de vos préférences d'automatisation",
    es: "Obteniendo tus preferencias de automatización",
    ar: "جلب تفضيلات الأتمتة",
    zh: "正在获取自动化偏好",
    ff: "Nana ƴeewa cuɓe otomatisaasiyoŋ maa",
  },
  "restaurant.automation.infoTitle": {
    en: "Auto-accept & Kitchen Print",
    fr: "Acceptation auto & impression cuisine",
    es: "Aceptación automática e impresión",
    ar: "قبول تلقائي وطباعة المطبخ",
    zh: "自动接单与厨房打印",
    ff: "Jaɓgol otomatik e print kuɗol",
  },
  "restaurant.automation.infoBody": {
    en: "Control how new orders are accepted and printed.",
    fr: "Contrôlez comment les nouvelles commandes sont acceptées et imprimées.",
    es: "Controla cómo se aceptan e imprimen los nuevos pedidos.",
    ar: "تحكم في كيفية قبول الطلبات الجديدة وطباعتها.",
    zh: "控制新订单的接单与打印方式。",
    ff: "Njiyloto no yamirooje kesi njaɓete e nprintete.",
  },
  "restaurant.automation.autoAccept": {
    en: "Auto-accept new orders",
    fr: "Accepter automatiquement les nouvelles commandes",
    es: "Aceptar automáticamente nuevos pedidos",
    ar: "قبول الطلبات الجديدة تلقائياً",
    zh: "自动接受新订单",
    ff: "Jaɓ yamirooje kesi otomatik",
  },
  "restaurant.automation.autoPrint": {
    en: "Auto-print on accept",
    fr: "Impression auto à l'acceptation",
    es: "Imprimir automáticamente al aceptar",
    ar: "طباعة تلقائية عند القبول",
    zh: "接单后自动打印",
    ff: "Print otomatik so jaɓaa",
  },
  "restaurant.automation.soundAlert": {
    en: "Sound alert",
    fr: "Alerte sonore",
    es: "Alerta sonora",
    ar: "تنبيه صوتي",
    zh: "声音提醒",
    ff: "Alarme son",
  },
  "restaurant.automation.defaultPrep": {
    en: "Default Prep Time",
    fr: "Temps de préparation par défaut",
    es: "Tiempo de prep. predeterminado",
    ar: "وقت التحضير الافتراضي",
    zh: "默认备餐时间",
    ff: "Waktu peewnugol goowaaɗo",
  },
  "driver.identity.screenTitle": {
    en: "Identity Verification",
    fr: "Vérification d'identité",
    es: "Verificación de identidad",
    ar: "التحقق من الهوية",
    zh: "身份验证",
    ff: "Ñeewndo neɗɗankaagal",
  },
  "driver.identity.loading": {
    en: "Loading...",
    fr: "Chargement...",
    es: "Cargando...",
    ar: "جاري التحميل...",
    zh: "加载中…",
    ff: "Loowgol...",
  },
  "driver.identity.waitHint": {
    en: "Please wait while we verify your identity.\nThis may take a few moments.",
    fr: "Veuillez patienter pendant la vérification de votre identité.\nCela peut prendre quelques instants.",
    es: "Espere mientras verificamos su identidad.\nEsto puede tardar unos momentos.",
    ar: "يرجى الانتظار بينما نتحقق من هويتك.\nقد يستغرق ذلك بضع لحظات.",
    zh: "正在验证您的身份，请稍候。\n这可能需要一些时间。",
    ff: "Njokkee seɗɗa haa min ñeewnda neɗɗankaagal maa.\nƊum waawi ƴettude seɗɗa.",
  },
  "promotions.screenTitle": {
    en: "Promotions",
    fr: "Promotions",
    es: "Promociones",
    ar: "العروض",
    zh: "优惠活动",
    ff: "Promoosiyaŋji",
  },
  "driver.vehicles.title": {
    en: "My vehicles",
    fr: "Mes véhicules",
    es: "Mis vehículos",
    ar: "مركباتي",
    zh: "我的车辆",
    ff: "Otooji am",
  },
  "driver.vehicles.subtitleManage": {
    en: "Manage your vehicle fleet",
    fr: "Gérez votre flotte de véhicules",
    es: "Gestiona tu flota de vehículos",
    ar: "إدارة أسطول مركباتك",
    zh: "管理您的车队",
    ff: "Njiyloto flotte otooji maa",
  },
  "driver.vehicles.subtitleActive": {
    en: "Only one active vehicle at a time",
    fr: "Un seul véhicule actif à la fois",
    es: "Solo un vehículo activo a la vez",
    ar: "مركبة نشطة واحدة فقط في كل مرة",
    zh: "一次只能有一辆启用车辆",
    ff: "Otoo gooto tan ena huutoree e sahaa",
  },
  "driver.vehicles.loading": {
    en: "Loading your vehicles...",
    fr: "Chargement de vos véhicules...",
    es: "Cargando tus vehículos...",
    ar: "جاري تحميل مركباتك...",
    zh: "正在加载您的车辆…",
    ff: "Loowgol otooji maa...",
  },
  "driver.services.title": {
    en: "My services",
    fr: "Mes services",
    es: "Mis servicios",
    ar: "خدماتي",
    zh: "我的服务",
    ff: "Sarwiisji am",
  },
  "driver.services.subtitle": {
    en: "Manage your mission types",
    fr: "Gérez vos types de missions",
    es: "Gestiona tus tipos de misiones",
    ar: "إدارة أنواع مهامك",
    zh: "管理您的任务类型",
    ff: "Njiyloto sifaaaji mission maa",
  },
  "driver.services.loading": {
    en: "Loading your services...",
    fr: "Chargement de vos services...",
    es: "Cargando tus servicios...",
    ar: "جاري تحميل خدماتك...",
    zh: "正在加载您的服务…",
    ff: "Loowgol sarwiisji maa...",
  },
  "driver.services.food": {
    en: "Food delivery",
    fr: "Livraison de repas",
    es: "Entrega de comida",
    ar: "توصيل الطعام",
    zh: "餐饮配送",
    ff: "Neldugol ñamdu",
  },
  "driver.services.package": {
    en: "Package delivery",
    fr: "Livraison de colis",
    es: "Entrega de paquetes",
    ar: "توصيل الطرود",
    zh: "包裹配送",
    ff: "Neldugol pakke",
  },
  "driver.services.taxi": {
    en: "Taxi rides",
    fr: "Courses taxi",
    es: "Viajes en taxi",
    ar: "رحلات التاكسي",
    zh: "出租车行程",
    ff: "Yahduuji taksi",
  },
  "common.a11y.close": {
    en: "Close",
    fr: "Fermer",
    es: "Cerrar",
    ar: "إغلاق",
    zh: "关闭",
    ff: "Uddu",
  },
  "common.a11y.closeFilter": {
    en: "Close filter",
    fr: "Fermer le filtre",
    es: "Cerrar filtro",
    ar: "إغلاق عامل التصفية",
    zh: "关闭筛选",
    ff: "Uddu filtre",
  },
  "common.a11y.closeMenu": {
    en: "Close menu",
    fr: "Fermer le menu",
    es: "Cerrar menú",
    ar: "إغلاق القائمة",
    zh: "关闭菜单",
    ff: "Uddu menu",
  },
  "common.a11y.retry": {
    en: "Retry",
    fr: "Réessayer",
    es: "Reintentar",
    ar: "إعادة المحاولة",
    zh: "重试",
    ff: "Fuɗɗito",
  },
  "common.a11y.back": {
    en: "Back",
    fr: "Retour",
    es: "Atrás",
    ar: "رجوع",
    zh: "返回",
    ff: "Rutto",
  },
  "driver.map.preparingNavigation": {
    en: "Preparing navigation…",
    fr: "Préparation de la navigation…",
    es: "Preparando la navegación…",
    ar: "جارٍ تجهيز التنقل…",
    zh: "正在准备导航…",
    ff: "Peewnugol navigation…",
  },
  "restaurant.orders.accept": {
    en: "Accept",
    fr: "Accepter",
    es: "Aceptar",
    ar: "قبول",
    zh: "接受",
    ff: "Jaɓ",
  },
  "restaurant.orders.prepared": {
    en: "Prepared",
    fr: "Préparé",
    es: "Preparado",
    ar: "جاهز للتحضير",
    zh: "已备好",
    ff: "Peewnaama",
  },
  "restaurant.orders.ready": {
    en: "Ready",
    fr: "Prêt",
    es: "Listo",
    ar: "جاهز",
    zh: "就绪",
    ff: "Hewtii",
  },
};

function setDeep(obj, dotted, value) {
  const parts = dotted.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

let added = 0;
for (const lang of ["en", "fr", "es", "ar", "zh", "ff"]) {
  const file = path.join(root, lang, "common.json");
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const [key, map] of Object.entries(KEYS)) {
    const value = map[lang] ?? map.en;
    setDeep(json, key, value);
    added += 1;
  }
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n", "utf8");
}
console.log(`Patched ${Object.keys(KEYS).length} keys × 6 locales (${added} writes)`);
