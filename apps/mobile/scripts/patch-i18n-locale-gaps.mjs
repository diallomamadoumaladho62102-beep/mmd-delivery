/**
 * One-shot durable locale gap fill for production i18n consistency.
 * Deep-merges missing keys into en/fr/es/ar/zh/ff common.json + extras.json.
 * Does not overwrite existing non-empty strings.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const localesDir = path.join(root, "src", "i18n", "locales");
const LANGS = ["en", "fr", "es", "ar", "zh", "ff"];

function deepMergeMissing(target, source) {
  let added = 0;
  for (const [k, v] of Object.entries(source)) {
    if (v != null && typeof v === "object" && !Array.isArray(v)) {
      if (target[k] == null || typeof target[k] !== "object") target[k] = {};
      added += deepMergeMissing(target[k], v);
    } else if (target[k] == null || target[k] === "") {
      target[k] = v;
      added += 1;
    }
  }
  return added;
}

const COMMON = {
  en: {
    common: {
      backShort: "BACK",
      cancel: "Cancel",
      logout: "Log out",
    },
    client: {
      auth: {
        showPassword: "Show",
        hidePassword: "Hide",
        forgotPassword: "Forgot password?",
      },
    },
    restaurant: {
      signOut: {
        title: "Log out",
        body: "Sign out of this device? Your restaurant account and data stay intact.",
        confirm: "Log out",
        error: "Unable to sign out right now.",
      },
      home: {
        status: {
          title: "Restaurant status",
          subtitle: "Choose how you receive orders.",
          online: "ONLINE",
          onlineShort: "ONLINE",
          offlineShort: "OFFLINE",
          busyShort: "BUSY",
          setup: "SETUP",
        },
        nav: {
          home: "Home",
          dashboard: "Dashboard",
          orders: "Orders",
          menu: "Menu",
          drivers: "Drivers",
          stats: "Statistics",
          payouts: "Payouts",
          finance: "Finances",
          tax: "Taxes",
          dash: "Day overview",
          heatmap: "Heatmap",
          ai: "MMD AI",
          settings: "Settings",
          security: "Security",
          language: "Language",
        },
        map: {
          offlineTitle: "Restaurant Offline",
          offlineHint: "Go online to show drivers and heat.",
        },
        filter: {
          all: "All statuses",
          pending: "Pending",
          accepted: "Accepted",
          prepared: "Preparing",
          ready: "Ready",
        },
      },
    },
  },
  fr: {
    common: {
      backShort: "RETOUR",
      cancel: "Annuler",
      logout: "Se déconnecter",
    },
    client: {
      auth: {
        showPassword: "Voir",
        hidePassword: "Cacher",
        forgotPassword: "Mot de passe oublié ?",
      },
    },
    restaurant: {
      signOut: {
        title: "Déconnexion",
        body: "Se déconnecter de cet appareil ? Votre compte restaurant et vos données restent intacts.",
        confirm: "Se déconnecter",
        error: "Impossible de se déconnecter pour le moment.",
      },
      home: {
        status: {
          title: "Statut du restaurant",
          subtitle: "Choisissez comment recevoir les commandes.",
          online: "EN LIGNE",
          onlineShort: "EN LIGNE",
          offlineShort: "HORS LIGNE",
          busyShort: "OCCUPÉ",
          setup: "CONFIG",
        },
        nav: {
          home: "Accueil",
          dashboard: "Tableau de bord",
          orders: "Commandes",
          menu: "Menu",
          drivers: "Livreurs",
          stats: "Statistiques",
          payouts: "Paiements",
          finance: "Finances",
          tax: "Taxes",
          dash: "Aperçu du jour",
          heatmap: "Carte de chaleur",
          ai: "MMD AI",
          settings: "Paramètres",
          security: "Sécurité",
          language: "Langue",
        },
        map: {
          offlineTitle: "Restaurant hors ligne",
          offlineHint: "Passez en ligne pour afficher les livreurs et la chaleur.",
        },
        filter: {
          all: "Tous les statuts",
          pending: "En attente",
          accepted: "Accepté",
          prepared: "En préparation",
          ready: "Prêt",
        },
      },
    },
  },
  es: {
    common: { backShort: "ATRÁS", cancel: "Cancelar", logout: "Cerrar sesión" },
    client: {
      auth: {
        showPassword: "Mostrar",
        hidePassword: "Ocultar",
        forgotPassword: "¿Olvidaste la contraseña?",
      },
    },
    restaurant: {
      signOut: {
        title: "Cerrar sesión",
        body: "¿Cerrar sesión en este dispositivo? Tu cuenta de restaurante y tus datos se conservan.",
        confirm: "Cerrar sesión",
        error: "No se puede cerrar sesión ahora.",
      },
      home: {
        status: {
          title: "Estado del restaurante",
          subtitle: "Elige cómo recibir pedidos.",
          online: "EN LÍNEA",
          onlineShort: "EN LÍNEA",
          offlineShort: "FUERA DE LÍNEA",
          busyShort: "OCUPADO",
          setup: "CONFIG",
        },
        nav: {
          home: "Inicio",
          dashboard: "Panel",
          orders: "Pedidos",
          menu: "Menú",
          drivers: "Repartidores",
          stats: "Estadísticas",
          payouts: "Pagos",
          finance: "Finanzas",
          tax: "Impuestos",
          dash: "Resumen del día",
          heatmap: "Mapa de calor",
          ai: "MMD AI",
          settings: "Ajustes",
          security: "Seguridad",
          language: "Idioma",
        },
        map: {
          offlineTitle: "Restaurante desconectado",
          offlineHint: "Conéctate para mostrar repartidores y el mapa de calor.",
        },
        filter: {
          all: "Todos los estados",
          pending: "Pendiente",
          accepted: "Aceptado",
          prepared: "En preparación",
          ready: "Listo",
        },
      },
    },
  },
  ar: {
    common: { backShort: "رجوع", cancel: "إلغاء", logout: "تسجيل الخروج" },
    client: {
      auth: {
        showPassword: "إظهار",
        hidePassword: "إخفاء",
        forgotPassword: "نسيت كلمة المرور؟",
      },
    },
    restaurant: {
      signOut: {
        title: "تسجيل الخروج",
        body: "تسجيل الخروج من هذا الجهاز؟ يبقى حساب المطعم وبياناتك كما هي.",
        confirm: "تسجيل الخروج",
        error: "تعذر تسجيل الخروج الآن.",
      },
      home: {
        status: {
          title: "حالة المطعم",
          subtitle: "اختر كيفية استلام الطلبات.",
          online: "متصل",
          onlineShort: "متصل",
          offlineShort: "غير متصل",
          busyShort: "مشغول",
          setup: "إعداد",
        },
        nav: {
          home: "الرئيسية",
          dashboard: "لوحة التحكم",
          orders: "الطلبات",
          menu: "القائمة",
          drivers: "السائقون",
          stats: "الإحصاءات",
          payouts: "المدفوعات",
          finance: "المالية",
          tax: "الضرائب",
          dash: "نظرة اليوم",
          heatmap: "خريطة الحرارة",
          ai: "MMD AI",
          settings: "الإعدادات",
          security: "الأمان",
          language: "اللغة",
        },
        map: {
          offlineTitle: "المطعم غير متصل",
          offlineHint: "اتصل لإظهار السائقين والحرارة.",
        },
        filter: {
          all: "كل الحالات",
          pending: "قيد الانتظار",
          accepted: "مقبول",
          prepared: "قيد التحضير",
          ready: "جاهز",
        },
      },
    },
  },
  zh: {
    common: { backShort: "返回", cancel: "取消", logout: "退出登录" },
    client: {
      auth: {
        showPassword: "显示",
        hidePassword: "隐藏",
        forgotPassword: "忘记密码？",
      },
    },
    restaurant: {
      signOut: {
        title: "退出登录",
        body: "从此设备退出？餐厅账户和数据将保留。",
        confirm: "退出登录",
        error: "暂时无法退出登录。",
      },
      home: {
        status: {
          title: "餐厅状态",
          subtitle: "选择如何接收订单。",
          online: "在线",
          onlineShort: "在线",
          offlineShort: "离线",
          busyShort: "忙碌",
          setup: "设置",
        },
        nav: {
          home: "首页",
          dashboard: "仪表盘",
          orders: "订单",
          menu: "菜单",
          drivers: "骑手",
          stats: "统计",
          payouts: "收款",
          finance: "财务",
          tax: "税务",
          dash: "今日概览",
          heatmap: "热力图",
          ai: "MMD AI",
          settings: "设置",
          security: "安全",
          language: "语言",
        },
        map: {
          offlineTitle: "餐厅离线",
          offlineHint: "上线以显示骑手和热力。",
        },
        filter: {
          all: "全部状态",
          pending: "待处理",
          accepted: "已接单",
          prepared: "制作中",
          ready: "就绪",
        },
      },
    },
  },
  ff: {
    common: { backShort: "RTTR", cancel: "Haɗtu", logout: "Seŋtude" },
    client: {
      auth: {
        showPassword: "Hollu",
        hidePassword: "Suuɗ",
        forgotPassword: "A yejjitii finnde?",
      },
    },
    restaurant: {
      signOut: {
        title: "Seŋtude",
        body: "Seŋtude e ngal kaɓirgal? Konte restoraa e keɓe maa ina njokki.",
        confirm: "Seŋtude",
        error: "Waawaa seŋtude jooni.",
      },
      home: {
        status: {
          title: "Ngonka restoraa",
          subtitle: "Suɓo no keɓata ɗaŋngeeje.",
          online: "E nder laylaytol",
          onlineShort: "ONLINE",
          offlineShort: "OFFLINE",
          busyShort: "BUSY",
          setup: "SETUP",
        },
        nav: {
          home: "Jaɓɓorgo",
          dashboard: "Dashboard",
          orders: "Ɗaŋngeeje",
          menu: "Menu",
          drivers: "Dogginooɓe",
          stats: "Limtooji",
          payouts: "Njoɓɗi",
          finance: "Kaalis",
          tax: "Taxe",
          dash: "Yiytirde ñalnde",
          heatmap: "Heatmap",
          ai: "MMD AI",
          settings: "Teelte",
          security: "Kisal",
          language: "Ɗemngal",
        },
        map: {
          offlineTitle: "Restoraa offline",
          offlineHint: "Naat e laylaytol ngam hollude dogginooɓe e heat.",
        },
        filter: {
          all: "Ngonkeeji fof",
          pending: "Nana sabbi",
          accepted: "Jaɓaama",
          prepared: "Nana heblaa",
          ready: "Hebiima",
        },
      },
    },
  },
};

const EXTRAS = {
  en: {
    taxi: {
      home: {
        moreOptions: "More options",
        wallet: "Wallet",
        bookSubtitle: "Book a ride — separate from delivery packages.",
      },
    },
    payment: {
      stripe: {
        paymentCanceled: "Payment canceled.",
        tipPaymentCanceled: "Tip payment canceled.",
        applePayUnavailableTitle: "Apple Pay unavailable",
        applePayUnavailableBody:
          "Apple Pay is not available for this app build. You can pay with a card, or ask support to verify Apple Pay Merchant ID configuration.",
        walletPayUnavailable:
          "Wallet pay is unavailable on this device. Please use a card.",
      },
    },
    client: {
      restaurantMenu: {
        pickupAddressLabel: "Pickup address (restaurant / start point)",
        deliveryAddressLabel: "Delivery address (customer)",
      },
    },
  },
  fr: {
    taxi: {
      home: {
        moreOptions: "Plus d'options",
        wallet: "Portefeuille",
        bookSubtitle: "Réserver une course — séparé des livraisons colis.",
      },
    },
    payment: {
      stripe: {
        paymentCanceled: "Paiement annulé.",
        tipPaymentCanceled: "Paiement du tip annulé.",
        applePayUnavailableTitle: "Apple Pay indisponible",
        applePayUnavailableBody:
          "Apple Pay n'est pas disponible pour cette version de l'application. Vous pouvez payer par carte, ou demander au support de vérifier la configuration du Merchant ID Apple Pay.",
        walletPayUnavailable:
          "Le paiement portefeuille n'est pas disponible sur cet appareil. Veuillez utiliser une carte.",
      },
    },
    client: {
      restaurantMenu: {
        pickupAddressLabel: "Adresse de retrait (restaurant / point de départ)",
        deliveryAddressLabel: "Adresse de livraison (client)",
      },
    },
  },
  es: {
    taxi: {
      home: {
        moreOptions: "Más opciones",
        wallet: "Billetera",
      },
    },
    payment: {
      stripe: {
        paymentCanceled: "Pago cancelado.",
        tipPaymentCanceled: "Pago de propina cancelado.",
        applePayUnavailableTitle: "Apple Pay no disponible",
        applePayUnavailableBody:
          "Apple Pay no está disponible en esta versión de la app. Puedes pagar con tarjeta o pedir a soporte que verifique el Merchant ID.",
        walletPayUnavailable:
          "El pago con billetera no está disponible. Usa una tarjeta.",
      },
    },
    client: {
      restaurantMenu: {
        pickupAddressLabel: "Dirección de recogida (restaurante / inicio)",
        deliveryAddressLabel: "Dirección de entrega (cliente)",
      },
    },
  },
  ar: {
    taxi: {
      home: {
        moreOptions: "المزيد من الخيارات",
        wallet: "المحفظة",
      },
    },
    payment: {
      stripe: {
        paymentCanceled: "تم إلغاء الدفع.",
        tipPaymentCanceled: "تم إلغاء دفع الإكرامية.",
        applePayUnavailableTitle: "Apple Pay غير متاح",
        applePayUnavailableBody:
          "Apple Pay غير متاح لهذا الإصدار. يمكنك الدفع بالبطاقة أو طلب التحقق من إعدادات Merchant ID.",
        walletPayUnavailable: "الدفع بالمحفظة غير متاح. يرجى استخدام بطاقة.",
      },
    },
    client: {
      restaurantMenu: {
        pickupAddressLabel: "عنوان الاستلام (المطعم / نقطة البداية)",
        deliveryAddressLabel: "عنوان التسليم (العميل)",
      },
    },
  },
  zh: {
    taxi: {
      home: {
        moreOptions: "更多选项",
        wallet: "钱包",
      },
    },
    payment: {
      stripe: {
        paymentCanceled: "付款已取消。",
        tipPaymentCanceled: "小费付款已取消。",
        applePayUnavailableTitle: "Apple Pay 不可用",
        applePayUnavailableBody:
          "此应用版本无法使用 Apple Pay。请使用银行卡，或联系支持检查 Merchant ID 配置。",
        walletPayUnavailable: "此设备不支持钱包支付。请使用银行卡。",
      },
    },
    client: {
      restaurantMenu: {
        pickupAddressLabel: "取餐地址（餐厅 / 起点）",
        deliveryAddressLabel: "送餐地址（客户）",
      },
    },
  },
  ff: {
    taxi: {
      home: {
        moreOptions: "Cuɓe goɗɗe",
        wallet: "Wallet",
      },
    },
    payment: {
      stripe: {
        paymentCanceled: "Njoɓdi haɗtaa.",
        tipPaymentCanceled: "Njoɓdi tip haɗtaa.",
        applePayUnavailableTitle: "Apple Pay heɓaaka",
        applePayUnavailableBody:
          "Apple Pay heɓaaka e ngal yahrude app. Huutoro kartal walla ɗaɓɓit support ngam ƴeewde Merchant ID.",
        walletPayUnavailable: "Wallet njoɓdi heɓaaka. Huutoro kartal.",
      },
    },
    client: {
      restaurantMenu: {
        pickupAddressLabel: "Ñiiɓirde ƴettugol (restoraa / fuɗɗoode)",
        deliveryAddressLabel: "Ñiiɓirde bakkagol (kiliyaŋke)",
      },
    },
  },
};

let total = 0;
for (const lang of LANGS) {
  const commonPath = path.join(localesDir, lang, "common.json");
  const extrasPath = path.join(localesDir, lang, "extras.json");
  const common = JSON.parse(fs.readFileSync(commonPath, "utf8"));
  const extras = JSON.parse(fs.readFileSync(extrasPath, "utf8"));
  const a = deepMergeMissing(common, COMMON[lang] || {});
  const b = deepMergeMissing(extras, EXTRAS[lang] || {});
  fs.writeFileSync(commonPath, `${JSON.stringify(common, null, 2)}\n`, "utf8");
  fs.writeFileSync(extrasPath, `${JSON.stringify(extras, null, 2)}\n`, "utf8");
  console.log(`${lang}: +${a} common, +${b} extras`);
  total += a + b;
}
console.log(JSON.stringify({ ok: true, keysAdded: total }));
