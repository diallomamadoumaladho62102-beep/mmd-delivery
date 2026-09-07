import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "i18n",
  "locales",
);

function set(obj, dotted, value) {
  const parts = dotted.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

const aliasesByLang = {
  en: {
    "driver.vehicle.seats": "Passenger seats",
    "driver.vehicle.field.type": "Type (sedan, suv, van, minivan)",
    "driver.vehicle.field.fuel":
      "Motorisation (gasoline, diesel, hybrid, electric, plug_in_hybrid)",
    "driver.vehicle.createSubtitle":
      "Type: {{type}}. Taxi categories are calculated by the server.",
    "driver.vehicle.taxiCategoriesHint":
      "Taxi categories are calculated by the server.",
    "driver.vehicle.photoPreview": "Vehicle photo preview",
    "driver.vehicle.noPhoto": "No photo yet",
    "driver.vehicle.amenity.luggage": "Large luggage",
    "driver.vehicle.amenity.charger": "Phone charger",
    "driver.vehicle.amenity.nonsmoking": "Non-smoking",
    "driver.vehicle.taxiCategories": "Taxi categories (server)",
    "driver.vehicle.addAction": "Add",
  },
  fr: {
    "driver.vehicle.seats": "Places passagers",
    "driver.vehicle.field.type": "Type (sedan, suv, van, minivan)",
    "driver.vehicle.field.fuel":
      "Motorisation (essence, diesel, hybride, électrique, plug_in_hybrid)",
    "driver.vehicle.createSubtitle":
      "Type : {{type}}. Les catégories taxi sont calculées par le serveur.",
    "driver.vehicle.taxiCategoriesHint":
      "Les catégories taxi sont calculées par le serveur.",
    "driver.vehicle.photoPreview": "Aperçu de la photo du véhicule",
    "driver.vehicle.noPhoto": "Pas encore de photo",
    "driver.vehicle.amenity.luggage": "Grands bagages",
    "driver.vehicle.amenity.charger": "Chargeur téléphone",
    "driver.vehicle.amenity.nonsmoking": "Non-fumeur",
    "driver.vehicle.taxiCategories": "Catégories taxi (serveur)",
    "driver.vehicle.addAction": "Ajouter",
  },
  es: {
    "driver.vehicle.seats": "Asientos de pasajeros",
    "driver.vehicle.field.type": "Tipo (sedan, suv, van, minivan)",
    "driver.vehicle.field.fuel":
      "Motorización (gasolina, diésel, híbrido, eléctrico, plug_in_hybrid)",
    "driver.vehicle.createSubtitle":
      "Tipo: {{type}}. Las categorías de taxi las calcula el servidor.",
    "driver.vehicle.taxiCategoriesHint":
      "Las categorías de taxi las calcula el servidor.",
    "driver.vehicle.photoPreview": "Vista previa de la foto",
    "driver.vehicle.noPhoto": "Sin foto aún",
    "driver.vehicle.amenity.luggage": "Equipaje grande",
    "driver.vehicle.amenity.charger": "Cargador de teléfono",
    "driver.vehicle.amenity.nonsmoking": "No fumar",
    "driver.vehicle.taxiCategories": "Categorías de taxi (servidor)",
    "driver.vehicle.addAction": "Añadir",
  },
  ar: {
    "driver.vehicle.seats": "مقاعد الركاب",
    "driver.vehicle.field.type": "النوع (sedan, suv, van, minivan)",
    "driver.vehicle.field.fuel":
      "المحرك (gasoline, diesel, hybrid, electric, plug_in_hybrid)",
    "driver.vehicle.createSubtitle":
      "النوع: {{type}}. فئات التاكسي يحسبها الخادم.",
    "driver.vehicle.taxiCategoriesHint": "فئات التاكسي يحسبها الخادم.",
    "driver.vehicle.photoPreview": "معاينة صورة المركبة",
    "driver.vehicle.noPhoto": "لا توجد صورة بعد",
    "driver.vehicle.amenity.luggage": "أمتعة كبيرة",
    "driver.vehicle.amenity.charger": "شاحن هاتف",
    "driver.vehicle.amenity.nonsmoking": "ممنوع التدخين",
    "driver.vehicle.taxiCategories": "فئات التاكسي (الخادم)",
    "driver.vehicle.addAction": "إضافة",
  },
  zh: {
    "driver.vehicle.seats": "乘客座位数",
    "driver.vehicle.field.type": "类型 (sedan, suv, van, minivan)",
    "driver.vehicle.field.fuel":
      "动力 (gasoline, diesel, hybrid, electric, plug_in_hybrid)",
    "driver.vehicle.createSubtitle":
      "类型：{{type}}。出租车类别由服务器计算。",
    "driver.vehicle.taxiCategoriesHint": "出租车类别由服务器计算。",
    "driver.vehicle.photoPreview": "车辆照片预览",
    "driver.vehicle.noPhoto": "暂无照片",
    "driver.vehicle.amenity.luggage": "大件行李",
    "driver.vehicle.amenity.charger": "手机充电器",
    "driver.vehicle.amenity.nonsmoking": "禁烟",
    "driver.vehicle.taxiCategories": "出租车类别（服务器）",
    "driver.vehicle.addAction": "添加",
  },
  ff: {
    "driver.vehicle.seats": "Jooɗorɗe yahooɓe",
    "driver.vehicle.field.type": "Sifaa (sedan, suv, van, minivan)",
    "driver.vehicle.field.fuel":
      "Motorisation (gasoline, diesel, hybrid, electric, plug_in_hybrid)",
    "driver.vehicle.createSubtitle":
      "Sifaa: {{type}}. Kategoriiji taksi ina limtee e serveur.",
    "driver.vehicle.taxiCategoriesHint":
      "Kategoriiji taksi ina limtee e serveur.",
    "driver.vehicle.photoPreview": "Yiytagol nata otoo",
    "driver.vehicle.noPhoto": "Alaa nata tawo",
    "driver.vehicle.amenity.luggage": "Bagage mawɗe",
    "driver.vehicle.amenity.charger": "Chargeur telefon",
    "driver.vehicle.amenity.nonsmoking": "Alaa yitte",
    "driver.vehicle.taxiCategories": "Kategoriiji taksi (serveur)",
    "driver.vehicle.addAction": "Ɓeydu",
  },
};

for (const lang of Object.keys(aliasesByLang)) {
  const p = path.join(root, lang, "common.json");
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  for (const [k, v] of Object.entries(aliasesByLang[lang])) set(j, k, v);
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
  console.log("aliases", lang);
}
console.log("OK");
