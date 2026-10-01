import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "i18n");
const catalogPath = path.join(dir, "adminUiCatalog.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));

const keys = {
  "Driver Integrity": {
    en: "Driver Integrity",
    fr: "Intégrité chauffeur",
    es: "Integridad del conductor",
    ar: "نزاهة السائق",
    zh: "司机诚信",
    ff: "Laaɓal dogoowo",
  },
  "Operational anti-abuse monitoring. An anomaly is not automatic fraud.": {
    en: "Operational anti-abuse monitoring. An anomaly is not automatic fraud.",
    fr: "Surveillance opérationnelle anti-abus. Une anomalie n’est pas une fraude automatique.",
    es: "Monitoreo operativo antiabuso. Una anomalía no es fraude automático.",
    ar: "مراقبة تشغيلية لمكافحة إساءة الاستخدام. الشذوذ ليس احتيالًا تلقائيًا.",
    zh: "运营防滥用监测。异常并不自动等于欺诈。",
    ff: "Rewindowal golle anti-abuse. Anomali wonaa janfa automatik.",
  },
  "Active warnings": {
    en: "Active warnings",
    fr: "Avertissements actifs",
    es: "Avisos activos",
    ar: "تحذيرات نشطة",
    zh: "有效警告",
    ff: "Jeertinooje cuudi",
  },
  "Drivers without progress": {
    en: "Drivers without progress",
    fr: "Chauffeurs sans progression",
    es: "Conductores sin progreso",
    ar: "سائقون بلا تقدم",
    zh: "无进展的司机",
    ff: "Dogooɓe alaa yahdu",
  },
  "Reassigned orders": {
    en: "Reassigned orders",
    fr: "Commandes réattribuées",
    es: "Pedidos reasignados",
    ar: "طلبات أُعيد إسنادها",
    zh: "已改派订单",
    ff: "Yamirooje rokkaaɗe woɗɓe",
  },
  Incidents: { en: "Incidents", fr: "Dossiers d’incident", es: "Expedientes", ar: "حوادث", zh: "事件", ff: "Ciftiiɗe" },
  Reviews: { en: "Reviews", fr: "Revues", es: "Revisiones", ar: "مراجعات", zh: "审核", ff: "Ƴeewndaaɗe" },
  Communications: { en: "Communications", fr: "Échanges", es: "Comunicaciones", ar: "الاتصالات", zh: "沟通记录", ff: "Jokkondiral" },
  Sanctions: { en: "Sanctions", fr: "Mesures disciplinaires", es: "Sanciones", ar: "جزاءات", zh: "处分", ff: "Njeñtudi" },
  Disputes: { en: "Disputes", fr: "Litiges", es: "Disputas", ar: "نزاعات", zh: "争议", ff: "Luural" },
  "Restaurant delay": { en: "Restaurant delay", fr: "Retard restaurant", es: "Retraso del restaurante", ar: "تأخير المطعم", zh: "餐厅延误", ff: "Ñaawo restoran" },
  "Order issue": { en: "Order issue", fr: "Problème de commande", es: "Problema del pedido", ar: "مشكلة في الطلب", zh: "订单问题", ff: "Caɗeele odaare" },
  Traffic: { en: "Traffic", fr: "Circulation", es: "Tráfico", ar: "ازدحام مروري", zh: "交通拥堵", ff: "Trafic laawol" },
  "GPS issue": { en: "GPS issue", fr: "Problème GPS", es: "Problema de GPS", ar: "مشكلة GPS", zh: "GPS 问题", ff: "Caɗeele GPS" },
  "Technical issue": { en: "Technical issue", fr: "Problème technique", es: "Problema técnico", ar: "مشكلة تقنية", zh: "技术问题", ff: "Caɗeele karallaagal" },
  "Vehicle issue": { en: "Vehicle issue", fr: "Problème véhicule", es: "Problema del vehículo", ar: "مشكلة المركبة", zh: "车辆问题", ff: "Caɗeele oto" },
  "Safety issue": { en: "Safety issue", fr: "Problème de sécurité", es: "Problema de seguridad", ar: "مشكلة سلامة", zh: "安全问题", ff: "Caɗeele hisnol" },
  Other: { en: "Other", fr: "Autre", es: "Otro", ar: "أخرى", zh: "其他", ff: "Goɗɗum" },
  "Contact driver": { en: "Contact driver", fr: "Contacter le chauffeur", es: "Contactar al conductor", ar: "الاتصال بالسائق", zh: "联系司机", ff: "Jokkondir e dogoowo" },
  "Monitoring enabled": { en: "Monitoring enabled", fr: "Surveillance activée", es: "Monitoreo habilitado", ar: "المراقبة مفعّلة", zh: "已启用监测", ff: "Rewindowal udditii" },
  "Warning notifications enabled": { en: "Warning notifications enabled", fr: "Notifications d’avertissement activées", es: "Avisos habilitados", ar: "إشعارات التحذير مفعّلة", zh: "已启用警告通知", ff: "Tintine jeertin udditii" },
  "Automatic reassignment enabled": { en: "Automatic reassignment enabled", fr: "Réattribution automatique activée", es: "Reasignación automática habilitada", ar: "إعادة الإسناد التلقائي مفعّلة", zh: "已启用自动改派", ff: "Rokkugol woɗɗo automatik udditii" },
  "Contact enabled": { en: "Contact enabled", fr: "Contact activé", es: "Contacto habilitado", ar: "التواصل مفعّل", zh: "已启用联系", ff: "Jokkondiral udditii" },
  "Review enabled": { en: "Review enabled", fr: "Revue activée", es: "Revisión habilitada", ar: "المراجعة مفعّلة", zh: "已启用审核", ff: "Ƴeewndo udditii" },
  "Sanction workflow enabled": { en: "Sanction workflow enabled", fr: "Workflow de sanction activé", es: "Flujo de sanción habilitado", ar: "سير الجزاءات مفعّل", zh: "已启用处分流程", ff: "Workflow njeñtudi udditii" },
  Warning: { en: "Warning", fr: "Avertissement", es: "Aviso", ar: "تحذير", zh: "警告", ff: "Jeertin" },
  "Final warning": { en: "Final warning", fr: "Avertissement final", es: "Aviso final", ar: "تحذير أخير", zh: "最终警告", ff: "Jeertin wattiniingo" },
  Reassigned: { en: "Reassigned", fr: "Réattribué", es: "Reasignado", ar: "أُعيد إسناده", zh: "已改派", ff: "Rokkaama woɗɗo" },
  Review: { en: "Review", fr: "Revue", es: "Revisión", ar: "مراجعة", zh: "审核", ff: "Ƴeewndo" },
  Confirmed: { en: "Confirmed", fr: "Confirmé", es: "Confirmado", ar: "مؤكد", zh: "已确认", ff: "Teeŋtinaama" },
  "Not confirmed": { en: "Not confirmed", fr: "Non confirmé", es: "No confirmado", ar: "غير مؤكد", zh: "未确认", ff: "Teeŋtinaaka" },
  "Policy action": { en: "Policy action", fr: "Action de politique", es: "Acción de política", ar: "إجراء سياسي", zh: "政策处置", ff: "Gollal politik" },
  "Open review": { en: "Open review", fr: "Ouvrir une revue", es: "Abrir revisión", ar: "فتح مراجعة", zh: "打开审核", ff: "Uddit ƴeewndo" },
  Trip: { en: "Trip", fr: "Course", es: "Viaje", ar: "رحلة", zh: "行程", ff: "Yahdu" },
  "Warning after accept (seconds)": {
    en: "Warning after accept (seconds)",
    fr: "Avertissement après acceptation (secondes)",
    es: "Aviso tras aceptar (segundos)",
    ar: "تحذير بعد القبول (ثوانٍ)",
    zh: "接单后警告（秒）",
    ff: "Jeertin caggal jaɓgol (sejillaaji)",
  },
  "Reassignment after no progress (seconds)": {
    en: "Reassignment after no progress (seconds)",
    fr: "Réattribution sans progression (secondes)",
    es: "Reasignación sin progreso (segundos)",
    ar: "إعادة إسناد دون تقدم (ثوانٍ)",
    zh: "无进展后改派（秒）",
    ff: "Rokkugol woɗɗo so alaa yahdu (sejillaaji)",
  },
  "Pickup progress warning (seconds)": {
    en: "Pickup progress warning (seconds)",
    fr: "Avertissement progression ramassage (secondes)",
    es: "Aviso de progreso de recogida (segundos)",
    ar: "تحذير تقدم الاستلام (ثوانٍ)",
    zh: "取餐进展警告（秒）",
    ff: "Jeertin yahdu pickup (sejillaaji)",
  },
  "Review after no progress (seconds)": {
    en: "Review after no progress (seconds)",
    fr: "Revue sans progression (secondes)",
    es: "Revisión sin progreso (segundos)",
    ar: "مراجعة دون تقدم (ثوانٍ)",
    zh: "无进展后审核（秒）",
    ff: "Ƴeewndo so alaa yahdu (sejillaaji)",
  },
  "Restaurant wait review threshold (seconds)": {
    en: "Restaurant wait review threshold (seconds)",
    fr: "Seuil de revue d’attente restaurant (secondes)",
    es: "Umbral de revisión de espera en restaurante (segundos)",
    ar: "عتبة مراجعة انتظار المطعم (ثوانٍ)",
    zh: "餐厅等待审核阈值（秒）",
    ff: "Keɓe ƴeewndo sabbindol restoran (sejillaaji)",
  },
  "Long trip threshold (seconds)": {
    en: "Long trip threshold (seconds)",
    fr: "Seuil de course longue (secondes)",
    es: "Umbral de viaje largo (segundos)",
    ar: "عتبة الرحلة الطويلة (ثوانٍ)",
    zh: "超长行程阈值（秒）",
    ff: "Keɓe yahdu juutndu (sejillaaji)",
  },
  "Stationary threshold (seconds)": {
    en: "Stationary threshold (seconds)",
    fr: "Seuil d’immobilité (secondes)",
    es: "Umbral de inmovilidad (segundos)",
    ar: "عتبة التوقف (ثوانٍ)",
    zh: "静止阈值（秒）",
    ff: "Keɓe ñiiɓgol (sejillaaji)",
  },
  "GPS stale after (seconds)": {
    en: "GPS stale after (seconds)",
    fr: "GPS périmé après (secondes)",
    es: "GPS obsoleto después de (segundos)",
    ar: "GPS قديم بعد (ثوانٍ)",
    zh: "GPS 过期时间（秒）",
    ff: "GPS ɓooyɗo caggal (sejillaaji)",
  },
  "GPS jump threshold (meters)": {
    en: "GPS jump threshold (meters)",
    fr: "Seuil de saut GPS (mètres)",
    es: "Umbral de salto GPS (metros)",
    ar: "عتبة قفزة GPS (أمتار)",
    zh: "GPS 跳跃阈值（米）",
    ff: "Keɓe diwtol GPS (meetir)",
  },
  "Movement progress threshold (meters)": {
    en: "Movement progress threshold (meters)",
    fr: "Seuil de progression de mouvement (mètres)",
    es: "Umbral de progreso de movimiento (metros)",
    ar: "عتبة تقدم الحركة (أمتار)",
    zh: "移动进展阈值（米）",
    ff: "Keɓe yahdu dille (meetir)",
  },
  "Impossible speed threshold (m/s)": {
    en: "Impossible speed threshold (m/s)",
    fr: "Seuil de vitesse impossible (m/s)",
    es: "Umbral de velocidad imposible (m/s)",
    ar: "عتبة السرعة المستحيلة (م/ث)",
    zh: "不可能速度阈值（米/秒）",
    ff: "Keɓe speed mo waawaa (m/s)",
  },
  "Invalid threshold": {
    en: "Invalid threshold",
    fr: "Seuil invalide",
    es: "Umbral no válido",
    ar: "عتبة غير صالحة",
    zh: "无效阈值",
    ff: "Keɓe mo moƴƴaani",
  },
  "Contact driver is disabled": {
    en: "Contact driver is disabled",
    fr: "Le contact chauffeur est désactivé",
    es: "El contacto con el conductor está desactivado",
    ar: "الاتصال بالسائق معطّل",
    zh: "司机联系已关闭",
    ff: "Jokkondiral dogoowo uddaama",
  },
  Saved: { en: "Saved", fr: "Enregistré", es: "Guardado", ar: "تم الحفظ", zh: "已保存", ff: "Danndaama" },
  Info: { en: "Info", fr: "Information", es: "Información", ar: "معلومة", zh: "信息", ff: "Humpito" },
};

for (const [key, tr] of Object.entries(keys)) {
  const existing = catalog[key] ?? {};
  const next = { ...tr };
  for (const [locale, value] of Object.entries(existing)) {
    if (typeof value === "string" && value.trim()) next[locale] = value;
  }
  catalog[key] = next;
}

fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
const ts = `export type AdminUiTranslation = { en?: string; fr?: string; es?: string; ar?: string; zh?: string; ff?: string };

export const ADMIN_UI_CATALOG: Record<string, AdminUiTranslation> = ${JSON.stringify(catalog, null, 2)} as const;
`;
fs.writeFileSync(path.join(dir, "adminUiCatalog.generated.ts"), ts);
console.log(`upserted ${Object.keys(keys).length} driver-integrity i18n keys`);
