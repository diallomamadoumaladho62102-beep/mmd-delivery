import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "i18n", "locales");
const KEYS = {
  "location.picker.streetNumber": {
    en: "Street number *",
    fr: "Numéro de rue *",
    es: "Número de calle *",
    ar: "رقم الشارع *",
    zh: "门牌号 *",
    ff: "Limre laawol *",
  },
  "location.picker.streetNumberPh": {
    en: "123",
    fr: "123",
    es: "123",
    ar: "123",
    zh: "123",
    ff: "123",
  },
  "location.picker.city": {
    en: "City *",
    fr: "Ville *",
    es: "Ciudad *",
    ar: "المدينة *",
    zh: "城市 *",
    ff: "Wuro *",
  },
  "location.picker.cityPh": {
    en: "New York",
    fr: "New York",
    es: "New York",
    ar: "نيويورك",
    zh: "纽约",
    ff: "New York",
  },
  "location.picker.postal": {
    en: "ZIP / Postal code *",
    fr: "Code postal *",
    es: "Código postal *",
    ar: "الرمز البريدي *",
    zh: "邮编 *",
    ff: "Kod postal *",
  },
  "location.picker.postalPh": {
    en: "10001",
    fr: "10001",
    es: "10001",
    ar: "10001",
    zh: "10001",
    ff: "10001",
  },
  "location.picker.streetOptional": {
    en: "Street / place name (optional)",
    fr: "Rue / lieu (optionnel)",
    es: "Calle / lugar (opcional)",
    ar: "الشارع / اسم المكان (اختياري)",
    zh: "街道/地点名（可选）",
    ff: "Laawol / nokku (cuɓaaɗo)",
  },
  "location.picker.streetOptionalPh": {
    en: "Main St / building name",
    fr: "Rue principale / nom du bâtiment",
    es: "Calle principal / edificio",
    ar: "الشارع الرئيسي / اسم المبنى",
    zh: "主街 / 建筑名",
    ff: "Laawol mawɗol / innde suudu",
  },
  "location.picker.commune": {
    en: "Commune",
    fr: "Commune",
    es: "Comuna",
    ar: "البلدية",
    zh: "行政区",
    ff: "Kommune",
  },
  "location.picker.communePh": {
    en: "Matoto",
    fr: "Matoto",
    es: "Matoto",
    ar: "Matoto",
    zh: "Matoto",
    ff: "Matoto",
  },
  "location.picker.quartier": {
    en: "Quartier",
    fr: "Quartier",
    es: "Barrio",
    ar: "الحي",
    zh: "街区",
    ff: "Quartier",
  },
  "location.picker.quartierPh": {
    en: "Lambanyi",
    fr: "Lambanyi",
    es: "Lambanyi",
    ar: "Lambanyi",
    zh: "Lambanyi",
    ff: "Lambanyi",
  },
  "location.picker.landmark": {
    en: "Landmark search",
    fr: "Recherche de point de repère",
    es: "Buscar punto de referencia",
    ar: "البحث عن معلم",
    zh: "地标搜索",
    ff: "Yiylo nokku anndiraaɗo",
  },
  "location.picker.landmarkRequired": {
    en: "Landmark search *",
    fr: "Recherche de point de repère *",
    es: "Buscar punto de referencia *",
    ar: "البحث عن معلم *",
    zh: "地标搜索 *",
    ff: "Yiylo nokku anndiraaɗo *",
  },
  "location.picker.landmarkPh": {
    en: "Station Total, mosque, market...",
    fr: "Station Total, mosquée, marché...",
    es: "Estación Total, mezquita, mercado...",
    ar: "محطة Total، مسجد، سوق...",
    zh: "Total 加油站、清真寺、市场…",
    ff: "Station Total, juulirde, luumo...",
  },
  "location.picker.formattedOptional": {
    en: "Formatted address (optional)",
    fr: "Adresse formatée (optionnel)",
    es: "Dirección formateada (opcional)",
    ar: "العنوان المنسق (اختياري)",
    zh: "格式化地址（可选）",
    ff: "Ñiiɓirde mooftaande (cuɓaaɗo)",
  },
  "location.picker.formattedOptionalPh": {
    en: "Street or place name if known",
    fr: "Rue ou lieu si connu",
    es: "Calle o lugar si se conoce",
    ar: "الشارع أو المكان إن عُرف",
    zh: "已知的街道或地点名",
    ff: "Laawol walla nokku so anndaa",
  },
  "location.picker.directions": {
    en: "Describe your exact location *",
    fr: "Décrivez votre emplacement exact *",
    es: "Describe tu ubicación exacta *",
    ar: "صف موقعك بالضبط *",
    zh: "描述您的确切位置 *",
    ff: "Sifto nokku maa goonga *",
  },
  "location.picker.directionsPh": {
    en: "After Total station, second road on the right, yellow house with blue gate...",
    fr: "Après la station Total, 2e rue à droite, maison jaune avec portail bleu...",
    es: "Después de la estación Total, segunda calle a la derecha, casa amarilla con portón azul...",
    ar: "بعد محطة Total، الشارع الثاني يميناً، منزل أصفر ببوابة زرقاء...",
    zh: "过 Total 加油站后，右侧第二条路，黄房子蓝门…",
    ff: "Caggal Station Total, laawol ɗiɗaɓol ñaamo, suudu mboɗeeri e damal buloori...",
  },
  "location.picker.directionsMin": {
    en: "Minimum 8 characters required.",
    fr: "Minimum 8 caractères requis.",
    es: "Se requieren al menos 8 caracteres.",
    ar: "يلزم 8 أحرف على الأقل.",
    zh: "至少需要 8 个字符。",
    ff: "Haani ko famɗi 8 karakteer.",
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
console.log(`location.picker keys: ${Object.keys(KEYS).length}`);
