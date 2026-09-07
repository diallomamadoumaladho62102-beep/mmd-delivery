import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "i18n", "locales");
const KEYS = {
  "driver.vehicle.screenTitle": {
    en: "Vehicle",
    fr: "Véhicule",
    es: "Vehículo",
    ar: "المركبة",
    zh: "车辆",
    ff: "Otoo",
  },
  "driver.vehicle.detailsSubtitle": {
    en: "Vehicle details",
    fr: "Détails du véhicule",
    es: "Detalles del vehículo",
    ar: "تفاصيل المركبة",
    zh: "车辆详情",
    ff: "Cifol otoo",
  },
  "driver.vehicle.loading": {
    en: "Loading vehicle...",
    fr: "Chargement du véhicule...",
    es: "Cargando vehículo...",
    ar: "جاري تحميل المركبة...",
    zh: "正在加载车辆…",
    ff: "Loowgol otoo...",
  },
  "driver.vehicle.addTitle": {
    en: "Add a vehicle",
    fr: "Ajouter un véhicule",
    es: "Añadir un vehículo",
    ar: "إضافة مركبة",
    zh: "添加车辆",
    ff: "Ɓeydu otoo",
  },
  "driver.vehicle.chooseType": {
    en: "Choose the type first",
    fr: "Choisissez d'abord le type",
    es: "Elige primero el tipo",
    ar: "اختر النوع أولاً",
    zh: "请先选择类型",
    ff: "Cuɓo sifaa ado",
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
console.log("vehicle keys patched");
