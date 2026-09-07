/**
 * Patch DriverVehicleScreen chrome + all 6 locale packs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const localesRoot = path.join(root, "src", "i18n", "locales");

const KEYS = {
  "driver.vehicle.mode.car": { en: "Car", fr: "Voiture", es: "Coche", ar: "سيارة", zh: "汽车", ff: "Otoo" },
  "driver.vehicle.mode.carHint": {
    en: "Car - food, parcels, taxi",
    fr: "Voiture - repas, colis, taxi",
    es: "Coche - comida, paquetes, taxi",
    ar: "سيارة - طعام، طرود، تاكسي",
    zh: "汽车 - 餐饮、包裹、出租车",
    ff: "Otoo - ñamdu, pakke, taksi",
  },
  "driver.vehicle.mode.moto": { en: "Motorcycle", fr: "Moto", es: "Motocicleta", ar: "دراجة نارية", zh: "摩托车", ff: "Moto" },
  "driver.vehicle.mode.motoHint": {
    en: "Motorcycle - fast delivery",
    fr: "Moto - livraison rapide",
    es: "Motocicleta - entrega rápida",
    ar: "دراجة نارية - توصيل سريع",
    zh: "摩托车 - 快速配送",
    ff: "Moto - neldugol jaawngol",
  },
  "driver.vehicle.mode.bike": { en: "Bicycle", fr: "Vélo", es: "Bicicleta", ar: "دراجة هوائية", zh: "自行车", ff: "Weloo" },
  "driver.vehicle.mode.bikeHint": {
    en: "Bicycle - no motorized fleet required",
    fr: "Vélo - aucun véhicule motorisé requis",
    es: "Bicicleta - no requiere flota motorizada",
    ar: "دراجة هوائية - لا تحتاج أسطولاً مزوداً بمحرك",
    zh: "自行车 - 无需机动车队",
    ff: "Weloo - alaa otoo motoreeɗo haani",
  },
  "driver.vehicle.categorySynced": {
    en: "Category is synced automatically",
    fr: "La catégorie est synchronisée automatiquement",
    es: "La categoría se sincroniza automáticamente",
    ar: "تتم مزامنة الفئة تلقائياً",
    zh: "类别将自动同步",
    ff: "Sifaa sync-ete otomatik",
  },
  "driver.vehicle.bikeTitle": { en: "Bicycle", fr: "Vélo", es: "Bicicleta", ar: "دراجة هوائية", zh: "自行车", ff: "Weloo" },
  "driver.vehicle.bikeSubtitle": {
    en: "No motorized vehicle required",
    fr: "Aucun véhicule motorisé requis",
    es: "No se requiere vehículo motorizado",
    ar: "لا يلزم مركبة مزودة بمحرك",
    zh: "无需机动车辆",
    ff: "Alaa otoo motoreeɗo haani",
  },
  "driver.vehicle.changeType": { en: "Change type", fr: "Changer de type", es: "Cambiar tipo", ar: "تغيير النوع", zh: "更改类型", ff: "Waylu sifaa" },
  "driver.vehicle.changeTypeHint": {
    en: "Back to Car / Motorcycle / Bicycle selection",
    fr: "Retour au choix Voiture / Moto / Vélo",
    es: "Volver a Coche / Motocicleta / Bicicleta",
    ar: "العودة إلى اختيار سيارة / دراجة نارية / دراجة",
    zh: "返回汽车 / 摩托车 / 自行车选择",
    ff: "Rutto e cuɓal Otoo / Moto / Weloo",
  },
  "driver.vehicle.confirmBike": {
    en: "Confirm bicycle mode",
    fr: "Confirmer le mode vélo",
    es: "Confirmar modo bicicleta",
    ar: "تأكيد وضع الدراجة",
    zh: "确认自行车模式",
    ff: "Jaɓ mod weloo",
  },
  "driver.vehicle.confirmBikeHint": {
    en: "Confirm to sync with dispatch",
    fr: "Confirmer pour synchroniser avec le dispatch",
    es: "Confirma para sincronizar con el despacho",
    ar: "أكد للمزامنة مع التوزيع",
    zh: "确认以同步到调度",
    ff: "Jaɓ ngam sync e dispatch",
  },
  "driver.vehicle.changeVehicleType": {
    en: "Change vehicle type",
    fr: "Changer le type de véhicule",
    es: "Cambiar tipo de vehículo",
    ar: "تغيير نوع المركبة",
    zh: "更改车辆类型",
    ff: "Waylu sifaa otoo",
  },
  "driver.vehicle.photoTitle": { en: "Vehicle photo", fr: "Photo du véhicule", es: "Foto del vehículo", ar: "صورة المركبة", zh: "车辆照片", ff: "Natal otoo" },
  "driver.vehicle.photoPreview": { en: "Vehicle photo preview", fr: "Aperçu de la photo", es: "Vista previa de la foto", ar: "معاينة صورة المركبة", zh: "车辆照片预览", ff: "Yiytude natal otoo" },
  "driver.vehicle.noPhoto": { en: "No photo yet", fr: "Pas encore de photo", es: "Aún no hay foto", ar: "لا توجد صورة بعد", zh: "暂无照片", ff: "Alaa natal tawo" },
  "driver.vehicle.camera": { en: "Camera", fr: "Caméra", es: "Cámara", ar: "الكاميرا", zh: "相机", ff: "Kamera" },
  "driver.vehicle.gallery": { en: "Gallery", fr: "Galerie", es: "Galería", ar: "المعرض", zh: "图库", ff: "Galleeri" },
  "driver.vehicle.remove": { en: "Remove", fr: "Supprimer", es: "Eliminar", ar: "إزالة", zh: "删除", ff: "Momtu" },
  "driver.vehicle.seats": { en: "Passenger seats", fr: "Places passagers", es: "Asientos de pasajeros", ar: "مقاعد الركاب", zh: "乘客座位数", ff: "Jooɗorde yahooɓe" },
  "driver.vehicle.taxiCategories": {
    en: "Taxi categories (server)",
    fr: "Catégories taxi (serveur)",
    es: "Categorías de taxi (servidor)",
    ar: "فئات التاكسي (الخادم)",
    zh: "出租车类别（服务器）",
    ff: "Sifaaaji taksi (server)",
  },
  "driver.vehicle.taxiCategoriesHint": {
    en: "Taxi categories are calculated by the server.",
    fr: "Les catégories taxi sont calculées par le serveur.",
    es: "Las categorías de taxi las calcula el servidor.",
    ar: "يحسب الخادم فئات التاكسي.",
    zh: "出租车类别由服务器计算。",
    ff: "Sifaaaji taksi hiisaama e server.",
  },
  "driver.vehicle.amenity.ac": { en: "Air conditioning", fr: "Climatisation", es: "Aire acondicionado", ar: "تكييف", zh: "空调", ff: "Kondisioner" },
  "driver.vehicle.amenity.accessible": { en: "Accessible", fr: "Accessible", es: "Accesible", ar: "مخصص لذوي الاحتياجات", zh: "无障碍", ff: "Hebɓotoo" },
  "driver.vehicle.amenity.babySeat": { en: "Baby seat", fr: "Siège bébé", es: "Silla de bebé", ar: "مقعد أطفال", zh: "儿童座椅", ff: "Jooɗorde cukalel" },
  "driver.vehicle.amenity.luggage": { en: "Large luggage", fr: "Grands bagages", es: "Equipaje grande", ar: "أمتعة كبيرة", zh: "大件行李", ff: "Bagaji mawɗi" },
  "driver.vehicle.amenity.pets": { en: "Pets", fr: "Animaux", es: "Mascotas", ar: "حيوانات أليفة", zh: "宠物", ff: "Dabbaji" },
  "driver.vehicle.amenity.charger": { en: "Phone charger", fr: "Chargeur téléphone", es: "Cargador de teléfono", ar: "شاحن هاتف", zh: "手机充电器", ff: "Chargeur telefon" },
  "driver.vehicle.amenity.quiet": { en: "Quiet vehicle", fr: "Véhicule silencieux", es: "Vehículo silencioso", ar: "مركبة هادئة", zh: "安静车辆", ff: "Otoo deƴƴo" },
  "driver.vehicle.amenity.nonsmoking": { en: "Non-smoking", fr: "Non-fumeur", es: "No fumar", ar: "غير مدخنين", zh: "禁止吸烟", ff: "Alaa yitte" },
  "driver.vehicle.save": { en: "Save", fr: "Enregistrer", es: "Guardar", ar: "حفظ", zh: "保存", ff: "Mooftu" },
  "driver.vehicle.addAction": { en: "Add", fr: "Ajouter", es: "Añadir", ar: "إضافة", zh: "添加", ff: "Ɓeydu" },
  "driver.vehicle.photoHelp": {
    en: "Upload a clear photo of the vehicle",
    fr: "Téléversez une photo claire du véhicule",
    es: "Sube una foto clara del vehículo",
    ar: "ارفع صورة واضحة للمركبة",
    zh: "上传清晰的车辆照片",
    ff: "Neldu natal otoo laaɓɗo",
  },
  "driver.vehicle.field.make": { en: "Make", fr: "Marque", es: "Marca", ar: "الشركة المصنعة", zh: "品牌", ff: "Marka" },
  "driver.vehicle.field.model": { en: "Model", fr: "Modèle", es: "Modelo", ar: "الطراز", zh: "型号", ff: "Model" },
  "driver.vehicle.field.year": { en: "Year", fr: "Année", es: "Año", ar: "السنة", zh: "年份", ff: "Hitaande" },
  "driver.vehicle.field.color": { en: "Color", fr: "Couleur", es: "Color", ar: "اللون", zh: "颜色", ff: "Noone" },
  "driver.vehicle.field.plate": { en: "Plate", fr: "Plaque", es: "Matrícula", ar: "لوحة", zh: "车牌", ff: "Plaak" },
  "driver.vehicle.field.type": {
    en: "Type (sedan, suv, van, minivan)",
    fr: "Type (berline, suv, van, minivan)",
    es: "Tipo (sedán, suv, van, minivan)",
    ar: "النوع (سيدان، SUV، فان، ميني فان)",
    zh: "类型（轿车、SUV、面包车、小型厢式车）",
    ff: "Sifaa (sedan, suv, van, minivan)",
  },
  "driver.vehicle.field.fuel": {
    en: "Motorisation (gasoline, diesel, hybrid, electric, plug_in_hybrid)",
    fr: "Motorisation (essence, diesel, hybride, électrique, hybride rechargeable)",
    es: "Motorización (gasolina, diésel, híbrido, eléctrico, híbrido enchufable)",
    ar: "المحرك (بنزين، ديزل، هجين، كهربائي، هجين قابل للشحن)",
    zh: "动力类型（汽油、柴油、混动、电动、插电混动）",
    ff: "Motor (gasoline, diesel, hybrid, electric, plug_in_hybrid)",
  },
  "driver.vehicle.field.nickname": {
    en: "Nickname (optional)",
    fr: "Surnom (optionnel)",
    es: "Apodo (opcional)",
    ar: "اسم مستعار (اختياري)",
    zh: "昵称（可选）",
    ff: "Innde (cuɓaaɗo)",
  },
  "driver.vehicle.createSubtitle": {
    en: "Type: {{type}}. Taxi categories are calculated by the server.",
    fr: "Type : {{type}}. Les catégories taxi sont calculées par le serveur.",
    es: "Tipo: {{type}}. Las categorías de taxi las calcula el servidor.",
    ar: "النوع: {{type}}. يحسب الخادم فئات التاكسي.",
    zh: "类型：{{type}}。出租车类别由服务器计算。",
    ff: "Sifaa: {{type}}. Sifaaaji taksi hiisaama e server.",
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
  const file = path.join(localesRoot, lang, "common.json");
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const [key, map] of Object.entries(KEYS)) {
    setDeep(json, key, map[lang] ?? map.en);
  }
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n", "utf8");
}
console.log(`Patched ${Object.keys(KEYS).length} vehicle keys`);
