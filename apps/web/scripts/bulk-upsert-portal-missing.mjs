/**
 * Bulk-upsert remaining portal UI source strings into adminUiCatalog.json.
 * Keys are the exact JSX source (often French). English users get `en`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "i18n");
const catalogPath = path.join(dir, "adminUiCatalog.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));

/** [source, en, es, ar, zh, ff] — fr is source when source is French, else provided as 7th or inferred. */
const ROWS = [
  ["Réessayer", "Retry", "Reintentar", "إعادة المحاولة", "重试", "Fuɗɗit"],
  ["Disponible", "Available", "Disponible", "متاح", "可售", "Heɓotooɗo"],
  ["Annuler", "Cancel", "Cancelar", "إلغاء", "取消", "Haɗtu"],
  ["Ta part (estimée) :", "Your share (estimated):", "Tu parte (estimada):", "حصتك (تقديرية):", "你的分成（估计）：", "Yeru maa (est.):"],
  ["Adresses de la course", "Trip addresses", "Direcciones del viaje", "عناوين الرحلة", "行程地址", "Ñiiɓirɗe pijirle"],
  ["Ta rémunération chauffeur (estimation)", "Your driver pay (estimate)", "Tu pago de conductor (estimado)", "أجر السائق (تقدير)", "司机报酬（估计）", "Njoɓdi dogoowo (est.)"],
  ["Commande introuvable.", "Order not found.", "Pedido no encontrado.", "الطلب غير موجود.", "未找到订单。", "Njamndi yiytaaka."],
  ["Profil à compléter", "Profile incomplete", "Perfil incompleto", "الملف غير مكتمل", "资料未完成", "Profil timmaaki"],
  ["Accès limité", "Limited access", "Acceso limitado", "وصول محدود", "访问受限", "Naatgol haɗaama"],
  ["En attente d’approbation", "Pending approval", "Pendiente de aprobación", "في انتظار الموافقة", "等待批准", "Nana sabbi jaɓgol"],
  ["Chargement du programme de fidélité…", "Loading loyalty program…", "Cargando programa de fidelidad…", "جارٍ تحميل برنامج الولاء…", "正在加载忠诚计划…", "Nana loowa fidelite…"],
  ["Fidélité Restaurant", "Restaurant loyalty", "Fidelidad del restaurante", "ولاء المطعم", "餐厅忠诚", "Fidelite restoraa"],
  ["Votre compte de fidélité est temporairement suspendu. Contactez le support MMD.", "Your loyalty account is temporarily suspended. Contact MMD support.", "Tu cuenta de fidelidad está suspendida temporalmente. Contacta con soporte MMD.", "حساب الولاء موقوف مؤقتًا. تواصل مع دعم MMD.", "你的忠诚账户已暂时停用。请联系 MMD 支持。", "Konte fidelite maa dartinaama e sahaa. Jokkondir e ballal MMD."],
  ["Prochain niveau :", "Next level:", "Próximo nivel:", "المستوى التالي:", "下一等级：", "Tolno aroowo:"],
  ["Récompenses disponibles", "Available rewards", "Recompensas disponibles", "المكافآت المتاحة", "可用奖励", "Njoɓɗi heɓotooɗi"],
  ["Aucune récompense disponible pour le moment.", "No rewards available right now.", "No hay recompensas disponibles ahora.", "لا توجد مكافآت متاحة حاليًا.", "暂无可用奖励。", "Alaa njoɓɗi heɓotooɗi jooni."],
  ["Parrainage", "Referrals", "Referidos", "الإحالة", "推荐", "Parrainage"],
  ["Code de parrainage indisponible pour le moment.", "Referral code unavailable right now.", "Código de referido no disponible ahora.", "رمز الإحالة غير متاح حاليًا.", "推荐码暂不可用。", "Kod parrainage hebɓaaki jooni."],
  ["Tu dois être connecté pour voir cette page.", "You must be signed in to view this page.", "Debes iniciar sesión para ver esta página.", "يجب تسجيل الدخول لعرض هذه الصفحة.", "必须登录才能查看此页面。", "A foti naatde ngam yiyde ndee hello."],
  ["Adresse", "Address", "Dirección", "العنوان", "地址", "Ñiiɓirde"],
  ["Permis de conduire", "Driver’s license", "Permiso de conducir", "رخصة القيادة", "驾照", "Permis doggol"],
  ["Menu / Produits", "Menu / Products", "Menú / Productos", "القائمة / المنتجات", "菜单 / 产品", "Menu / Geɗe"],
  ["Menu du restaurant", "Restaurant menu", "Menú del restaurante", "قائمة المطعم", "餐厅菜单", "Menu restoraa"],
  ["Image", "Image", "Imagen", "صورة", "图片", "Nataal"],
  ["Client :", "Client:", "Cliente:", "العميل:", "客户：", "Kiliyee:"],
  ["Temps :", "Time:", "Tiempo:", "الوقت:", "时间：", "Waktu:"],
  ["Retrait (pickup)", "Pickup", "Recogida", "الاستلام", "取件", "Ñaggol"],
  ["Livraison (dropoff)", "Dropoff", "Entrega", "التسليم", "送达", "Neldugol"],
  ["Code de livraison", "Delivery code", "Código de entrega", "رمز التسليم", "配送码", "Kod neldugol"],
  ["Détails de la commande", "Order details", "Detalles del pedido", "تفاصيل الطلب", "订单详情", "Ceeŋte njamndi"],
  ["Commande", "Order", "Pedido", "طلب", "订单", "Njamndi"],
  ["Communiquez ce code uniquement au livreur.", "Share this code only with the courier.", "Comparte este código solo con el repartidor.", "شارك هذا الرمز مع المندوب فقط.", "仅向配送员出示此码。", "Hollu ndee kod tan neldowo."],
  ["Promotions & coupons", "Promotions & coupons", "Promociones y cupones", "العروض والقسائم", "促销与优惠券", "Promo e kuponuuji"],
  ["Nouveau mot de passe", "New password", "Nueva contraseña", "كلمة مرور جديدة", "新密码", "Finnde hesere"],
  ["Chargement de ton compte…", "Loading your account…", "Cargando tu cuenta…", "جارٍ تحميل حسابك…", "正在加载你的账户…", "Nana loowa konte maa…"],
  ["Aller vers la création de compte", "Go to account creation", "Ir a crear cuenta", "الانتقال لإنشاء حساب", "前往创建账户", "Yah to sosde konte"],
  ["Choisir mon type de compte", "Choose my account type", "Elegir mi tipo de cuenta", "اختر نوع حسابي", "选择我的账户类型", "Suɓo fannu konte am"],
  ["Adresse principale :", "Primary address:", "Dirección principal:", "العنوان الرئيسي:", "主要地址：", "Ñiiɓirde mawnde:"],
  ["Profil chauffeur / livreur", "Driver / courier profile", "Perfil de conductor / repartidor", "ملف السائق / المندوب", "司机 / 配送员资料", "Profil dogoowo / neldowo"],
  ["Dossier complet", "Complete file", "Expediente completo", "ملف مكتمل", "资料完整", "Dossier timmuɗo"],
  ["Fiche chauffeur introuvable", "Driver record not found", "Ficha de conductor no encontrada", "سجل السائق غير موجود", "未找到司机档案", "Fiche dogoowo yiytaaka"],
  ["Créer / compléter mon profil chauffeur", "Create / complete my driver profile", "Crear / completar mi perfil de conductor", "إنشاء / إكمال ملف السائق", "创建 / 完善司机资料", "Sos / timmin profil dogoowo am"],
  ["Mode :", "Mode:", "Modo:", "الوضع:", "模式：", "Mbaya:"],
  ["Statut :", "Status:", "Estado:", "الحالة:", "状态：", "Ngonka:"],
  ["Téléphone d’urgence :", "Emergency phone:", "Teléfono de emergencia:", "هاتف الطوارئ:", "紧急电话：", "Telefon kattanɗe:"],
  ["Date de naissance :", "Date of birth:", "Fecha de nacimiento:", "تاريخ الميلاد:", "出生日期：", "Ñalngu jibinannde:"],
  ["Disponibilité :", "Availability:", "Disponibilidad:", "التوفر:", "可用性：", "Heɓagol:"],
  ["Documents requis :", "Required documents:", "Documentos requeridos:", "المستندات المطلوبة:", "所需文件：", "Dokimaaji waɗɗiiɗi:"],
  ["Véhicule :", "Vehicle:", "Vehículo:", "المركبة:", "车辆：", "Oto:"],
  ["Permis :", "License:", "Licencia:", "الرخصة:", "执照：", "Permis:"],
  ["Ton profil chauffeur est incomplet", "Your driver profile is incomplete", "Tu perfil de conductor está incompleto", "ملف السائق غير مكتمل", "你的司机资料不完整", "Profil dogoowo maa timmaaki"],
  ["Mettre à jour mon profil chauffeur", "Update my driver profile", "Actualizar mi perfil de conductor", "تحديث ملف السائق", "更新司机资料", "Hesɗitin profil dogoowo am"],
  ["Ouvrir mon tableau de bord chauffeur", "Open my driver dashboard", "Abrir mi panel de conductor", "فتح لوحة السائق", "打开司机控制台", "Uddit dashboard dogoowo am"],
  ["Nom affiché :", "Display name:", "Nombre visible:", "الاسم الظاهر:", "显示名称：", "Innde yiyeteeɗe:"],
  ["Nom légal :", "Legal name:", "Nombre legal:", "الاسم القانوني:", "法定名称：", "Innde sariya:"],
  ["Contact principal :", "Primary contact:", "Contacto principal:", "جهة الاتصال الرئيسية:", "主要联系人：", "Jokkondiral mawngal:"],
  ["Tes actions", "Your actions", "Tus acciones", "إجراءاتك", "你的操作", "Golle maa"],
  ["Commandes", "Orders", "Pedidos", "الطلبات", "订单", "Njamndi"],
  ["Votre code professionnel", "Your professional code", "Tu código profesional", "رمزك المهني", "你的专业码", "Kod golle maa"],
  ["Campagnes Restaurant", "Restaurant campaigns", "Campañas del restaurante", "حملات المطعم", "餐厅活动", "Kampaañ restoraa"],
  ["Soumettre (validation MMD)", "Submit (MMD review)", "Enviar (validación MMD)", "إرسال (مراجعة MMD)", "提交（MMD 审核）", "Neldu (ƴeewndo MMD)"],
  ["Mes campagnes", "My campaigns", "Mis campañas", "حملاتي", "我的活动", "Kampaañe am"],
  ["Aucune.", "None.", "Ninguna.", "لا شيء.", "无。", "Alaa."],
  ["Demandes", "Requests", "Solicitudes", "الطلبات", "请求", "Ɗaɓɓaande"],
  ["Compte & contact", "Account & contact", "Cuenta y contacto", "الحساب وجهات الاتصال", "账户与联系", "Konte e jokkondiral"],
  ["Email de contact", "Contact email", "Correo de contacto", "بريد التواصل", "联系邮箱", "Iimeel jokkondiral"],
  ["Téléphone du restaurant", "Restaurant phone", "Teléfono del restaurante", "هاتف المطعم", "餐厅电话", "Telefon restoraa"],
  ["Détails du restaurant", "Restaurant details", "Detalles del restaurante", "تفاصيل المطعم", "餐厅详情", "Ceeŋte restoraa"],
  ["Code postal", "Postal code", "Código postal", "الرمز البريدي", "邮编", "Kod posto"],
  ["Description (optionnel)", "Description (optional)", "Descripción (opcional)", "الوصف (اختياري)", "描述（可选）", "Cifagol (wonaa waɗɗi)"],
  ["Logo du restaurant", "Restaurant logo", "Logo del restaurante", "شعار المطعم", "餐厅标志", "Logo restoraa"],
  ["Image de couverture", "Cover image", "Imagen de portada", "صورة الغلاف", "封面图", "Nataal cover"],
  ["Ouverture", "Opening", "Apertura", "الفتح", "开门", "Udditagol"],
  ["Fermeture", "Closing", "Cierre", "الإغلاق", "关门", "Uddugol"],
  ["Options de service", "Service options", "Opciones de servicio", "خيارات الخدمة", "服务选项", "Cuɓe sarwiis"],
  ["À emporter", "Pickup", "Para llevar", "الاستلام", "自取", "Ñaggol"],
  ["Sur place", "Dine-in", "En el local", "تناول في المطعم", "堂食", "E nder"],
  ["Infos business", "Business info", "Información del negocio", "معلومات النشاط", "商家信息", "Kabaruuji njulaagu"],
  ["Présence en ligne", "Online presence", "Presencia en línea", "الحضور الإلكتروني", "线上展示", "Yiygol e laylaytol"],
  ["Documents de vérification", "Verification documents", "Documentos de verificación", "وثائق التحقق", "验证文件", "Dokimaaji ƴeewndo"],
  ["Photo de profil", "Profile photo", "Foto de perfil", "صورة الملف", "头像", "Nataal profil"],
  ["Minimum 8 caractères", "Minimum 8 characters", "Mínimo 8 caracteres", "8 أحرف على الأقل", "至少 8 个字符", "Les 8 alkule"],
  ["Vélo", "Bike", "Bicicleta", "دراجة", "自行车", "Welo"],
  ["Voiture", "Car", "Coche", "سيارة", "汽车", "Oto"],
  ["Catégories", "Categories", "Categorías", "الفئات", "分类", "Pecce"],
  ["Ajouter un produit", "Add a product", "Añadir un producto", "إضافة منتج", "添加产品", "Ɓeydu geɗel"],
  ["Prix", "Price", "Precio", "السعر", "价格", "Njoɓdi"],
  ["Modifier", "Edit", "Editar", "تعديل", "编辑", "Waylu"],
  ["Créer une commande", "Create an order", "Crear un pedido", "إنشاء طلب", "创建订单", "Sos njamndi"],
  ["Non connecté", "Not signed in", "No has iniciado sesión", "غير مسجّل الدخول", "未登录", "A naataaki"],
  ["Adresse pickup", "Pickup address", "Dirección de recogida", "عنوان الاستلام", "取件地址", "Ñiiɓirde ñaaggol"],
  ["Adresse dropoff", "Dropoff address", "Dirección de entrega", "عنوان التسليم", "送达地址", "Ñiiɓirde neldugol"],
  ["Mes gains chauffeur", "My driver earnings", "Mis ganancias de conductor", "أرباح السائق", "我的司机收入", "Njoɓdi dogoowo am"],
  ["Download PDF", "Download PDF", "Descargar PDF", "تنزيل PDF", "下载 PDF", "Aawto PDF"],
  ["Generate PDF", "Generate PDF", "Generar PDF", "إنشاء PDF", "生成 PDF", "Sos PDF"],
  ["Tableau de bord chauffeur", "Driver dashboard", "Panel del conductor", "لوحة السائق", "司机控制台", "Dashboard dogoowo"],
  ["Courses à accepter", "Trips to accept", "Viajes por aceptar", "رحلات للقبول", "待接行程", "Pijirlooji ngam jaɓde"],
  ["Refuser la course", "Decline trip", "Rechazar viaje", "رفض الرحلة", "拒绝行程", "Salto pijirle"],
  ["Détails de la course", "Trip details", "Detalles del viaje", "تفاصيل الرحلة", "行程详情", "Ceeŋte pijirle"],
  ["Mes livraisons en cours", "My active deliveries", "Mis entregas en curso", "توصيلاتي الجارية", "进行中的配送", "Neldugol am cuɓaaɗe"],
  ["Voir la course", "View trip", "Ver viaje", "عرض الرحلة", "查看行程", "Yiy pijirle"],
  ["Course introuvable.", "Trip not found.", "Viaje no encontrado.", "الرحلة غير موجودة.", "未找到行程。", "Pijirle yiytaaka."],
  ["Code promo", "Promo code", "Código promo", "رمز ترويجي", "优惠码", "Kod promo"],
  ["Panier", "Cart", "Carrito", "السلة", "购物车", "Karto"],
  ["Sous-total :", "Subtotal:", "Subtotal:", "المجموع الفرعي:", "小计：", "Les-total:"],
  ["Total :", "Total:", "Total:", "الإجمالي:", "合计：", "Kalaa:"],
  ["Taxes :", "Taxes:", "Impuestos:", "الضرائب:", "税费：", "Njoɓdi laamu:"],
  ["Voir la commande", "View order", "Ver pedido", "عرض الطلب", "查看订单", "Yiy njamndi"],
  ["Écrire un message", "Write a message", "Escribir un mensaje", "اكتب رسالة", "写消息", "Winndu mesasu"],
  ["Uploader", "Upload", "Subir", "رفع", "上传", "Loow"],
  ["Retour au chat", "Back to chat", "Volver al chat", "العودة إلى الدردشة", "返回聊天", "Rutto chat"],
  ["Code pickup", "Pickup code", "Código de recogida", "رمز الاستلام", "取件码", "Kod ñaaggol"],
  ["Adresse de livraison", "Delivery address", "Dirección de entrega", "عنوان التوصيل", "配送地址", "Ñiiɓirde neldugol"],
  ["Instructions du client", "Customer instructions", "Instrucciones del cliente", "تعليمات العميل", "客户说明", "Ciimtol kiliyee"],
  ["Aucun article.", "No items.", "Ningún artículo.", "لا توجد أصناف.", "暂无菜品。", "Alaa geɗe."],
  ["Préparation", "Preparation", "Preparación", "التحضير", "备餐", "Hebtinde"],
  ["Mes dernières commandes", "My recent orders", "Mis últimos pedidos", "طلباتي الأخيرة", "最近订单", "Njamndi am cakkitiiɗi"],
  ["Profil complet.", "Profile complete.", "Perfil completo.", "الملف مكتمل.", "资料已完整。", "Profil timmii."],
  ["Loading notifications…", "Loading notifications…", "Cargando notificaciones…", "جارٍ تحميل الإشعارات…", "正在加载通知…", "Nana loowa tintine…"],
  ["No notifications yet.", "No notifications yet.", "Aún no hay notificaciones.", "لا توجد إشعارات بعد.", "暂无通知。", "Alaa tintine tawo."],
  ["Mark read", "Mark read", "Marcar leído", "تعيين كمقروء", "标为已读", "Maantor tarɗo"],
  ["Seller dashboard", "Seller dashboard", "Panel del vendedor", "لوحة البائع", "卖家控制台", "Dashboard jeeyoowo"],
  ["Team Members", "Team Members", "Miembros del equipo", "أعضاء الفريق", "团队成员", "Terɗe fedde"],
  ["Employee", "Employee", "Empleado", "موظف", "员工", "Gollotooɗo"],
  ["Manager", "Manager", "Gerente", "مدير", "经理", "Jiiloowo"],
];

function looksFrench(s) {
  return /[àâäéèêëïîôùûüçœæÀÂÄÉÈÊËÏÎÔÙÛÜÇ’']/.test(s) || /\b(le|la|les|des|une|est|pas|pour|avec|ton|tes|mon|mes)\b/i.test(s);
}

let added = 0;
for (const [source, en, es, ar, zh, ff] of ROWS) {
  const next = { en, es, ar, zh, ff };
  if (looksFrench(source)) next.fr = source;
  else {
    const FR_EN = {
      "Loading notifications…": "Chargement des notifications…",
      "No notifications yet.": "Aucune notification pour le moment.",
      "Mark read": "Marquer comme lu",
      "Seller dashboard": "Tableau de bord vendeur",
      "Team Members": "Membres de l’équipe",
      "Employee": "Employé",
      "Manager": "Manager",
      "Download PDF": "Télécharger le PDF",
      "Generate PDF": "Générer le PDF",
      "Promotions & coupons": "Promotions et coupons",
    };
    next.fr = FR_EN[source] || catalog[source]?.fr || en;
  }
  const prev = catalog[source];
  catalog[source] = { ...prev, ...next };
  if (!prev) added++;
}

fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
const ts = `/* AUTO-GENERATED — do not edit by hand */
import type { WebLocale } from "@/i18n/locales";

export type AdminUiTranslation = Partial<Record<WebLocale, string>> &
  Record<Exclude<WebLocale, "en">, string>;

export const ADMIN_UI_CATALOG: Record<string, AdminUiTranslation> = ${JSON.stringify(catalog, null, 2)} as const;
`;
fs.writeFileSync(path.join(dir, "adminUiCatalog.generated.ts"), ts);
console.log(JSON.stringify({ added, total: Object.keys(catalog).length, rows: ROWS.length }, null, 2));
