export type WebLocale = "en" | "fr" | "es" | "ar" | "zh" | "ff";

export const WEB_LOCALES: WebLocale[] = ["en", "fr", "es", "ar", "zh", "ff"];

export const WEB_LOCALE_LABELS: Record<WebLocale, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
  ar: "العربية",
  zh: "中文",
  ff: "Pulaar / Fulfulde",
};

type MessageTree = Record<string, string>;

const EN: MessageTree = {
  "app.title": "MMD Delivery",
  "app.description": "Delivery, taxi, restaurants and marketplace",
  "nav.home": "Home",
  "nav.login": "Log in",
  "nav.signup": "Sign up",
  "nav.client": "Client",
  "nav.restaurants": "Restaurants",
  "nav.marketplace": "Marketplace",
  "nav.seller": "Seller",
  "public.hero": "Your local delivery platform",
  "public.subhero": "Order food, book rides, shop marketplace — all in one app.",
  "public.feature.tracking": "Real-time Tracking",
  "public.feature.trackingDesc": "Track every order and delivery live.",
  "public.feature.payments": "Secure Payments",
  "public.feature.paymentsDesc": "Fast, safe and encrypted transactions.",
  "public.feature.driver": "Driver Earnings",
  "public.feature.driverDesc": "More deliveries, more opportunities.",
  "public.feature.restaurant": "Restaurant Tools",
  "public.feature.restaurantDesc": "Powerful business and order management.",
  "client.title": "My orders",
  "client.empty": "No orders yet.",
  "client.loading": "Loading…",
  "restaurant.title": "Restaurant portal",
  "seller.title": "Seller portal",
  "marketplace.title": "Marketplace",
};

const FR: MessageTree = {
  ...EN,
  "app.description": "Livraison, taxi, restaurants et marketplace",
  "nav.home": "Accueil",
  "nav.login": "Connexion",
  "nav.signup": "Inscription",
  "nav.client": "Client",
  "nav.restaurants": "Restaurants",
  "nav.marketplace": "Marketplace",
  "nav.seller": "Vendeur",
  "public.hero": "Votre plateforme de livraison locale",
  "public.subhero": "Commandez, réservez un taxi, achetez sur le marketplace.",
  "public.feature.tracking": "Suivi en direct",
  "public.feature.trackingDesc": "Suivez chaque commande en temps réel.",
  "public.feature.payments": "Paiements sécurisés",
  "public.feature.paymentsDesc": "Transactions rapides et chiffrées.",
  "public.feature.driver": "Revenus chauffeur",
  "public.feature.driverDesc": "Plus de livraisons, plus d'opportunités.",
  "public.feature.restaurant": "Outils restaurant",
  "public.feature.restaurantDesc": "Gestion des commandes simplifiée.",
  "client.title": "Mes commandes",
  "client.empty": "Aucune commande.",
  "client.loading": "Chargement…",
  "restaurant.title": "Espace restaurant",
  "seller.title": "Espace vendeur",
  "marketplace.title": "Marketplace",
};

const ES: MessageTree = {
  ...EN,
  "nav.home": "Inicio",
  "nav.login": "Entrar",
  "nav.signup": "Registrarse",
  "public.hero": "Tu plataforma local de entregas",
  "public.subhero": "Pedidos, taxi y marketplace en una sola app.",
  "client.title": "Mis pedidos",
  "client.empty": "Sin pedidos aún.",
  "client.loading": "Cargando…",
  "restaurant.title": "Portal restaurante",
  "seller.title": "Portal vendedor",
  "marketplace.title": "Marketplace",
};

const AR: MessageTree = {
  ...EN,
  "nav.home": "الرئيسية",
  "nav.login": "تسجيل الدخول",
  "nav.signup": "إنشاء حساب",
  "public.hero": "منصة التوصيل المحلية",
  "public.subhero": "طلبات، تاكسي، وسوق — في تطبيق واحد.",
  "client.title": "طلباتي",
  "client.empty": "لا توجد طلبات بعد.",
  "client.loading": "جاري التحميل…",
  "restaurant.title": "بوابة المطعم",
  "seller.title": "بوابة البائع",
  "marketplace.title": "السوق",
};

const ZH: MessageTree = {
  ...EN,
  "nav.home": "首页",
  "nav.login": "登录",
  "nav.signup": "注册",
  "public.hero": "您的本地配送平台",
  "public.subhero": "订餐、叫车、商城购物，尽在一 app。",
  "client.title": "我的订单",
  "client.empty": "暂无订单。",
  "client.loading": "加载中…",
  "restaurant.title": "餐厅门户",
  "seller.title": "卖家门户",
  "marketplace.title": "商城",
};

const FF: MessageTree = {
  ...FR,
  "public.hero": "Platform maa e nder leydi maa",
  "nav.home": "Accueil",
  "client.title": "Commandes am",
  "marketplace.title": "Suudu lataande",
};

export const WEB_MESSAGES: Record<WebLocale, MessageTree> = {
  en: EN,
  fr: FR,
  es: ES,
  ar: AR,
  zh: ZH,
  ff: FF,
};

/** Admin/staff UI stays EN/FR only — see apps/web/app/admin/* */
export const ADMIN_I18N_NOTE =
  "Admin UI: English + French only (staff bilingual). User-facing pages support en, fr, es, ar, zh, ff.";

export function normalizeWebLocale(raw: string | null | undefined): WebLocale {
  const v = String(raw ?? "en").trim().toLowerCase();
  if (v.startsWith("fr")) return "fr";
  if (v.startsWith("es")) return "es";
  if (v.startsWith("ar")) return "ar";
  if (v.startsWith("zh")) return "zh";
  if (v.startsWith("ff") || v.startsWith("fuc") || v.startsWith("pul")) return "ff";
  return "en";
}

export function webT(key: string, locale: WebLocale): string {
  return WEB_MESSAGES[locale]?.[key] ?? WEB_MESSAGES.en[key] ?? key;
}

export function webDir(locale: WebLocale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}
