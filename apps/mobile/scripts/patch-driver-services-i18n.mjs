/**
 * Append remaining driver.services i18n keys for release gate.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "i18n", "locales");

const KEYS = {
  "driver.services.availableSection": {
    en: "Available services",
    fr: "Services disponibles",
    es: "Servicios disponibles",
    ar: "الخدمات المتاحة",
    zh: "可用服务",
    ff: "Sarwiisji woodɗi",
  },
  "driver.services.advancedSection": {
    en: "Advanced options",
    fr: "Options avancées",
    es: "Opciones avanzadas",
    ar: "خيارات متقدمة",
    zh: "高级选项",
    ff: "Cuɓe ɓeydaaɗe",
  },
  "driver.services.foodDesc": {
    en: "Restaurant orders and meal delivery",
    fr: "Commandes restaurant et livraison repas",
    es: "Pedidos de restaurante y entrega de comida",
    ar: "طلبات المطاعم وتوصيل الوجبات",
    zh: "餐厅订单与餐食配送",
    ff: "Yamirooje restoraŋ e neldugol ñamdu",
  },
  "driver.services.packageDesc": {
    en: "Package and errand delivery",
    fr: "Livraison colis et courses",
    es: "Entrega de paquetes y mandados",
    ar: "توصيل الطرود والمهام",
    zh: "包裹与跑腿配送",
    ff: "Neldugol pakke e yahduuji",
  },
  "driver.services.taxiDesc": {
    en: "Taxi rides for your authorized vehicle categories",
    fr: "Courses taxi selon les catégories autorisées de votre véhicule",
    es: "Viajes en taxi según las categorías autorizadas de tu vehículo",
    ar: "رحلات تاكسي حسب فئات مركبتك المصرح بها",
    zh: "按您车辆授权类别接出租车订单",
    ff: "Yahduuji taksi e sifaaaji otoo maa jaɓaaɗi",
  },
  "driver.services.acceptStandard": {
    en: "Also accept Standard rides",
    fr: "Accepter aussi les courses Standard",
    es: "Aceptar también viajes Standard",
    ar: "قبول رحلات Standard أيضاً",
    zh: "同时接受 Standard 行程",
    ff: "Jaɓ kadi yahduuji Standard",
  },
  "driver.services.acceptStandardDesc": {
    en: "Comfort, XL or Wheelchair can also receive Standard rides",
    fr: "Comfort, XL ou Wheelchair peuvent recevoir des courses Standard",
    es: "Comfort, XL o Wheelchair también pueden recibir viajes Standard",
    ar: "Comfort و XL و Wheelchair يمكنها أيضاً استلام رحلات Standard",
    zh: "Comfort、XL 或 Wheelchair 也可接收 Standard 行程",
    ff: "Comfort, XL walla Wheelchair ena mbaawi heɓde kadi Standard",
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

for (const lang of ["en", "fr", "es", "ar", "zh", "ff"]) {
  const file = path.join(root, lang, "common.json");
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const [key, map] of Object.entries(KEYS)) {
    setDeep(json, key, map[lang] ?? map.en);
  }
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n", "utf8");
}
console.log(`Patched ${Object.keys(KEYS).length} driver.services keys`);
