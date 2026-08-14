/**
 * Sync taxi.* translations into locale extras.json (deep merge).
 * Fills English-identical keys and taxi.driver.activeRide for all 6 langs.
 * Run from apps/mobile: node scripts/sync-taxi-i18n.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(__dirname, "..", "src", "i18n", "locales");
const LANGS = ["en", "fr", "es", "ar", "zh", "ff"];

function deepMerge(base, override) {
  if (!override || typeof override !== "object") return base;
  const out = { ...base };
  for (const key of Object.keys(override)) {
    if (
      override[key] &&
      typeof override[key] === "object" &&
      !Array.isArray(override[key]) &&
      out[key] &&
      typeof out[key] === "object"
    ) {
      out[key] = deepMerge(out[key], override[key]);
    } else {
      out[key] = override[key];
    }
  }
  return out;
}

const enDriverActiveRide = {
  navigate: "Navigate",
  chat: "Chat",
  call: "Call",
  completeRide: "Complete ride",
  cancelTitle: "Cancel ride",
  cancelBody:
    "Cancel this taxi ride? Payment refund (if any) is handled by admin.",
  keepRide: "Keep ride",
  incorrectCode: "Incorrect code. Ask the client and try again.",
  verifyFailed: "Could not verify the code. Please try again.",
  arrivedPickup: "Arrived at pickup",
  verifyPickupCode: "Verify Pickup Code",
};

/** Nested taxi patches per language (merged into extras.taxi). */
const patches = {
  en: {
    driver: { activeRide: enDriverActiveRide },
  },
  fr: {
    common: { yes: "Oui" },
    favorites: { loadFailed: "Échec du chargement" },
    home: {
      title: "Taxi MMD",
      standard: "Berline",
      xl: "Grand volume",
      premium: "Haut de gamme",
    },
    loyalty: {
      loadFailed: "Échec du chargement",
      tier: "Niveau : {{tier}} • Total : {{lifetime}}",
    },
    loyaltyRewards: { loadFailed: "Échec du chargement" },
    quote: { distance: "Distance parcourue" },
    receipt: {
      actions: "Actions disponibles",
      fare: {
        coupon: "Bon de réduction",
        distance: "Distance parcourue",
        mmdPlus: "Abonnement MMD+",
        parking: "Frais de stationnement",
        promo: "Offre promotionnelle",
        total: "Montant total",
      },
      support: "Assistance",
    },
    ride: {
      chat: "Discussion",
      driverAssigned: "Chauffeur assigné",
    },
    scheduled: {
      loadFailed: "Échec du chargement",
      cancelFailed: "Échec de l'annulation",
    },
    tracking: {
      safety: { errorTitle: "Erreur", micTitle: "Micro du téléphone" },
    },
    ui: { total: "Montant total" },
    chat: { clientPlaceholder: "Message au client…" },
    driver: {
      activeRide: {
        navigate: "Naviguer",
        chat: "Discussion",
        call: "Appeler",
        completeRide: "Terminer la course",
        cancelTitle: "Annuler la course",
        cancelBody:
          "Annuler cette course taxi ? Le remboursement (le cas échéant) est géré par l'administration.",
        keepRide: "Garder la course",
        incorrectCode:
          "Code incorrect. Demandez au client et réessayez.",
        verifyFailed:
          "Impossible de vérifier le code. Veuillez réessayer.",
        arrivedPickup: "Arrivé au point de prise en charge",
        verifyPickupCode: "Vérifier le code de prise en charge",
      },
    },
  },
  es: {
    common: { yes: "Sí" },
    favorites: { loadFailed: "Error al cargar" },
    home: {
      title: "Taxi MMD",
      standard: "Estándar",
      xl: "Extra grande",
      premium: "De lujo",
    },
    loyalty: {
      loadFailed: "Error al cargar",
      tier: "Nivel: {{tier}} • Total acumulado: {{lifetime}}",
    },
    loyaltyRewards: { loadFailed: "Error al cargar" },
    quote: { distance: "Distancia" },
    chat: {
      clientPlaceholder: "Mensaje al cliente…",
    },
    ride: {
      chat: "Mensajes",
      driverAssigned: "Conductor asignado",
    },
    scheduled: {
      loadFailed: "Error al cargar",
      cancelFailed: "Error al cancelar",
    },
    tracking: {
      safety: { errorTitle: "Se produjo un error" },
    },
    ui: { total: "Importe total" },
    receipt: {
      title: "Recibo",
      view: "Ver recibo",
      invoice: "Factura",
      ride: "Viaje",
      trip: "Trayecto",
      tripMap: "Mapa del trayecto",
      mapUnavailable: "Mapa del trayecto no disponible",
      pickup: "Recogida",
      dropoff: "Destino",
      wait: "Espera",
      driver: "Conductor",
      rating: "Valoración",
      payment: "Pago",
      totalPaid: "Total pagado",
      history: "Historial financiero",
      support: "Soporte",
      helpCenter: "Centro de ayuda",
      actions: "Acciones",
      downloadPdf: "Descargar PDF",
      share: "Compartir",
      addTip: "Añadir propina",
      rebook: "Reservar de nuevo",
      contactSupport: "Contactar soporte",
      paymentRef: "Ref. de pago",
      businessWallet: "Monedero empresarial",
      card: "Tarjeta",
      loadFailed: "No se pudo cargar el recibo",
      missingRide: "Falta el ID del viaje",
      emptyTitle: "Sin recibo",
      emptyBody: "Este viaje aún no tiene recibo.",
      pdfFailed: "No se pudo crear el PDF",
      fare: {
        base: "Tarifa base",
        distance: "Distancia",
        time: "Tiempo",
        minimum: "Ajuste de tarifa mínima",
        surge: "Tarifa dinámica / alta demanda",
        tolls: "Peajes",
        parking: "Estacionamiento",
        bookingFee: "Tarifa de reserva",
        wait: "Tiempo de espera",
        airport: "Tarifa de aeropuerto",
        regulatory: "Tarifa de servicio",
        regulatoryFee: "Tarifa regulatoria",
        cleaning: "Tarifa de limpieza",
        tax: "Impuestos",
        promo: "Promoción",
        coupon: "Cupón",
        loyalty: "Puntos de fidelidad",
        shared: "Descuento viaje compartido",
        walletCredit: "Crédito del monedero",
        mmdPlus: "Plan MMD+",
        tip: "Propina",
        refund: "Reembolso",
        adjustment: "Ajuste",
        total: "Importe total",
      },
    },
    driver: {
      activeRide: {
        navigate: "Navegar",
        chat: "Mensajes",
        call: "Llamar",
        completeRide: "Completar viaje",
        cancelTitle: "Cancelar viaje",
        cancelBody:
          "¿Cancelar este viaje de taxi? El reembolso (si aplica) lo gestiona el administrador.",
        keepRide: "Mantener viaje",
        incorrectCode:
          "Código incorrecto. Pide al cliente e inténtalo de nuevo.",
        verifyFailed:
          "No se pudo verificar el código. Inténtalo de nuevo.",
        arrivedPickup: "Llegué al punto de recogida",
        verifyPickupCode: "Verificar código de recogida",
      },
    },
  },
  ar: {
    common: { yes: "نعم" },
    favorites: { loadFailed: "تعذّر التحميل" },
    home: {
      standard: "عادي",
      xl: "كبير جداً",
      premium: "فاخر",
    },
    loyalty: {
      loadFailed: "تعذّر التحميل",
      tier: "المستوى: {{tier}} • الإجمالي: {{lifetime}}",
    },
    loyaltyRewards: { loadFailed: "تعذّر التحميل" },
    quote: { distance: "المسافة" },
    chat: {
      clientPlaceholder: "رسالة إلى العميل…",
    },
    ride: {
      driverAssigned: "تم تعيين السائق",
    },
    scheduled: {
      loadFailed: "تعذّر التحميل",
      cancelFailed: "فشل الإلغاء",
    },
    ui: { total: "الإجمالي" },
    receipt: {
      title: "إيصال",
      view: "عرض الإيصال",
      invoice: "فاتورة",
      ride: "رحلة",
      trip: "مسار",
      tripMap: "خريطة المسار",
      mapUnavailable: "خريطة المسار غير متاحة",
      pickup: "الاستلام",
      dropoff: "التوصيل",
      wait: "انتظار",
      driver: "السائق",
      rating: "التقييم",
      payment: "الدفع",
      totalPaid: "المبلغ المدفوع",
      history: "السجل المالي",
      support: "الدعم",
      helpCenter: "مركز المساعدة",
      actions: "إجراءات",
      downloadPdf: "تنزيل PDF",
      share: "مشاركة",
      addTip: "إضافة بقشيش",
      rebook: "حجز مرة أخرى",
      contactSupport: "الاتصال بالدعم",
      paymentRef: "مرجع الدفع",
      businessWallet: "محفظة الأعمال",
      card: "بطاقة",
      loadFailed: "تعذّر تحميل الإيصال",
      missingRide: "معرّف الرحلة مفقود",
      emptyTitle: "لا يوجد إيصال",
      emptyBody: "لا يوجد إيصال لهذه الرحلة بعد.",
      pdfFailed: "تعذّر إنشاء PDF",
      fare: {
        base: "الأجرة الأساسية",
        distance: "المسافة",
        time: "الوقت",
        minimum: "تعديل الحد الأدنى للأجرة",
        surge: "تسعير ديناميكي / ذروة",
        tolls: "رسوم الطرق",
        parking: "موقف السيارات",
        bookingFee: "رسوم الحجز",
        wait: "وقت الانتظار",
        airport: "رسوم المطار",
        regulatory: "رسوم الخدمة",
        regulatoryFee: "رسوم تنظيمية",
        cleaning: "رسوم التنظيف",
        tax: "الضرائب",
        promo: "عرض ترويجي",
        coupon: "قسيمة",
        loyalty: "نقاط الولاء",
        shared: "خصم الرحلة المشتركة",
        walletCredit: "رصيد المحفظة",
        mmdPlus: "خطة MMD+",
        tip: "بقشيش",
        refund: "استرداد",
        adjustment: "تعديل",
        total: "الإجمالي",
      },
    },
    driver: {
      activeRide: {
        navigate: "التنقل",
        chat: "محادثة",
        call: "اتصال",
        completeRide: "إنهاء الرحلة",
        cancelTitle: "إلغاء الرحلة",
        cancelBody:
          "إلغاء رحلة التاكسي هذه؟ يُعالج الاسترداد (إن وُجد) من قبل الإدارة.",
        keepRide: "الإبقاء على الرحلة",
        incorrectCode: "رمز غير صحيح. اطلب من العميل وحاول مرة أخرى.",
        verifyFailed: "تعذّر التحقق من الرمز. حاول مرة أخرى.",
        arrivedPickup: "وصلت إلى نقطة الاستلام",
        verifyPickupCode: "التحقق من رمز الاستلام",
      },
    },
  },
  zh: {
    common: { yes: "是" },
    favorites: { loadFailed: "加载失败" },
    home: {
      standard: "标准",
      xl: "加大",
      premium: "豪华",
    },
    loyalty: {
      loadFailed: "加载失败",
      tier: "等级：{{tier}} • 累计：{{lifetime}}",
    },
    loyaltyRewards: { loadFailed: "加载失败" },
    quote: { distance: "距离" },
    chat: {
      clientPlaceholder: "给客户发消息…",
    },
    ride: {
      driverAssigned: "已分配司机",
    },
    scheduled: {
      loadFailed: "加载失败",
      cancelFailed: "取消失败",
    },
    ui: { total: "合计" },
    receipt: {
      title: "收据",
      view: "查看收据",
      invoice: "发票",
      ride: "行程",
      trip: "路线",
      tripMap: "行程地图",
      mapUnavailable: "行程地图不可用",
      pickup: "上车点",
      dropoff: "下车点",
      wait: "等待",
      driver: "司机",
      rating: "评分",
      payment: "支付",
      totalPaid: "已付总额",
      history: "财务记录",
      support: "支持",
      helpCenter: "帮助中心",
      actions: "操作",
      downloadPdf: "下载 PDF",
      share: "分享",
      addTip: "添加小费",
      rebook: "再次预订",
      contactSupport: "联系支持",
      paymentRef: "支付参考号",
      businessWallet: "企业钱包",
      card: "银行卡",
      loadFailed: "无法加载收据",
      missingRide: "缺少行程 ID",
      emptyTitle: "无收据",
      emptyBody: "此行程尚无收据。",
      pdfFailed: "无法创建 PDF",
      fare: {
        base: "基础车费",
        distance: "距离",
        time: "时间",
        minimum: "最低车费调整",
        surge: "动态加价 / 高峰",
        tolls: "过路费",
        parking: "停车费",
        bookingFee: "预订费",
        wait: "等待时间",
        airport: "机场费",
        regulatory: "服务费",
        regulatoryFee: "监管费",
        cleaning: "清洁费",
        tax: "税费",
        promo: "促销",
        coupon: "优惠券",
        loyalty: "积分",
        shared: "拼车折扣",
        walletCredit: "钱包抵扣",
        mmdPlus: "MMD+ 会员",
        tip: "小费",
        refund: "退款",
        adjustment: "调整",
        total: "合计",
      },
    },
    driver: {
      activeRide: {
        navigate: "导航",
        chat: "聊天",
        call: "呼叫",
        completeRide: "完成行程",
        cancelTitle: "取消行程",
        cancelBody: "取消此出租车行程？退款（如有）由管理员处理。",
        keepRide: "保留行程",
        incorrectCode: "验证码错误。请向客户确认后重试。",
        verifyFailed: "无法验证验证码，请重试。",
        arrivedPickup: "已到达上车点",
        verifyPickupCode: "验证上车码",
      },
    },
  },
  ff: {
    favorites: { loadFailed: "Loowgol firlitii" },
    home: {
      standard: "Caadi",
      xl: "Mawni",
      premium: "Ciiɗɗo",
    },
    loyalty: {
      loadFailed: "Loowgol firlitii",
      tier: "Daraja: {{tier}} • Ɗooɗe: {{lifetime}}",
    },
    loyaltyRewards: { loadFailed: "Loowgol firlitii" },
    quote: { distance: "Njuuɗe" },
    chat: {
      clientPlaceholder: "Ɓataama e jeyaaɓo…",
    },
    ride: {
      chat: "Ɓataama",
      driverAssigned: "Dooɓoowo tawtii",
    },
    scheduled: {
      loadFailed: "Loowgol firlitii",
      cancelFailed: "Haaltinde firlitii",
    },
    receipt: {
      title: "Receipt yahdu",
      view: "Yiy receipt yahdu",
      invoice: "Fatur",
      ride: "Yahdu",
      trip: "Laawol",
      tripMap: "Kartal laawol",
      mapUnavailable: "Kartal laawol alaa",
      pickup: "Ɗaɓɓugol",
      dropoff: "Jaɓɓugol",
      wait: "Nguurde",
      driver: "Dooɓoowo",
      rating: "Jaɓde",
      payment: "Jokko",
      totalPaid: "Jokko fof",
      history: "Aslol jokko",
      support: "Wallude",
      helpCenter: "Cokirde wallude",
      actions: "Golle",
      downloadPdf: "Awlugo PDF",
      share: "Neldude",
      addTip: "Ɓeydu tip",
      rebook: "Book kadi",
      contactSupport: "Jokkondir wallude",
      paymentRef: "Ref jokko",
      businessWallet: "Wallet business",
      card: "Kartal jokko",
      loadFailed: "Loowgol receipt firlitii",
      missingRide: "ID yahdu ina reese",
      emptyTitle: "Alaa receipt",
      emptyBody: "Yahdu oo alaa receipt hannde.",
      pdfFailed: "Sosde PDF firlitii",
      fare: {
        base: "Fare bas",
        distance: "Njuuɗe",
        time: "Waktu",
        minimum: "Teelte fare minimum",
        surge: "Ɓeydude daraja / pricing dinamik",
        tolls: "Jokko laawol",
        parking: "Jokko parking",
        bookingFee: "Jokko booking",
        wait: "Waktu nguurde",
        airport: "Jokko airport",
        regulatory: "Jokko service",
        regulatoryFee: "Jokko regulatory",
        cleaning: "Jokko cleaning",
        tax: "Jokko tax",
        promo: "Promotion fannu",
        coupon: "Coupon fannu",
        loyalty: "Points loyalty",
        shared: "Discount yahdu renndinde",
        walletCredit: "Credit wallet",
        mmdPlus: "Plan MMD+",
        tip: "Tip jokko",
        refund: "Artirde jokko",
        adjustment: "Teelte",
        total: "Fof",
      },
    },
    driver: {
      activeRide: {
        navigate: "Laawol",
        chat: "Ɓataama",
        call: "Noddu",
        completeRide: "Timmin yahdu",
        cancelTitle: "Haaltin yahdu",
        cancelBody:
          "Haaltin yahdu taxi oo? Refund (so ina woodi) admin ina ko waɗa.",
        keepRide: "Mooftu yahdu",
        incorrectCode:
          "Code moƴƴaaki. Laɓ e jeyaaɓo e ete kadi.",
        verifyFailed: "Verify code firlitii. Ete kadi.",
        arrivedPickup: "Arii e pickup",
        verifyPickupCode: "Verify code pickup",
      },
    },
  },
};

for (const lang of LANGS) {
  const file = path.join(localesDir, lang, "extras.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!data.taxi || typeof data.taxi !== "object") data.taxi = {};
  data.taxi = deepMerge(data.taxi, patches[lang] ?? {});
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(`updated ${lang}/extras.json taxi.*`);
}

console.log("sync-taxi-i18n done");
