import type { WebLocale } from "@/i18n/locales";

/**
 * Admin Control Center navigation + shell chrome — all 6 platform locales.
 * English labels in adminNav.ts are the translation keys.
 * Page bodies should use adminT() / useWebI18n progressively; shell is fully localized.
 */
const NAV: Record<string, Record<Exclude<WebLocale, "en">, string>> = {
  Dashboard: { fr: "Tableau de bord", es: "Panel", ar: "لوحة التحكم", zh: "仪表盘", ff: "Yiytude golle" },
  Overview: { fr: "Vue d'ensemble", es: "Resumen", ar: "نظرة عامة", zh: "概览", ff: "Yiytagol" },
  "People Ops": { fr: "RH / Personnel", es: "Personas", ar: "الموارد البشرية", zh: "人事运维", ff: "Yimɓe Ops" },
  Operations: { fr: "Opérations", es: "Operaciones", ar: "العمليات", zh: "运营", ff: "Golle" },
  Orders: { fr: "Commandes", es: "Pedidos", ar: "الطلبات", zh: "订单", ff: "Yamirooje" },
  Dispatch: { fr: "Dispatch", es: "Despacho", ar: "التوزيع", zh: "调度", ff: "Dispatch" },
  "Driver Offers": { fr: "Offres chauffeurs", es: "Ofertas de conductores", ar: "عروض السائقين", zh: "司机报价", ff: "Ofriiɗe dogooɓe" },
  "Driver Opportunities": { fr: "Opportunités chauffeurs", es: "Oportunidades de conductores", ar: "فرص السائقين", zh: "司机机会", ff: "Fartaŋŋe dogooɓe" },
  "Delivery Requests": { fr: "Demandes de livraison", es: "Solicitudes de entrega", ar: "طلبات التوصيل", zh: "配送请求", ff: "Ɗaɓɓitanɗe neldugol" },
  Taxi: { fr: "Taxi", es: "Taxi", ar: "تاكسي", zh: "出租车", ff: "Taksi" },
  "Taxi Scheduled": { fr: "Taxi planifiés", es: "Taxi programados", ar: "تاكسي مجدول", zh: "预约出租车", ff: "Taksi waktu" },
  "Taxi Shared Rides": { fr: "Courses partagées", es: "Viajes compartidos", ar: "رحلات مشتركة", zh: "拼车", ff: "Yahduuji luggiɗiiɗi" },
  "Taxi Promotions": { fr: "Promos taxi", es: "Promociones taxi", ar: "عروض التاكسي", zh: "出租车促销", ff: "Promoosiyaŋji taksi" },
  "Taxi Dispatch Prefs": { fr: "Préférences dispatch taxi", es: "Prefs. despacho taxi", ar: "تفضيلات توزيع التاكسي", zh: "出租车调度偏好", ff: "Cuɓe dispatch taksi" },
  "Business Accounts": { fr: "Comptes business", es: "Cuentas business", ar: "حسابات الأعمال", zh: "企业账户", ff: "Kontuuji business" },
  "Live Map": { fr: "Carte live", es: "Mapa en vivo", ar: "خريطة مباشرة", zh: "实时地图", ff: "Karte live" },
  Supervision: { fr: "Surveillance", es: "Supervisión", ar: "الإشراف", zh: "监管", ff: "Rewindowal" },
  "Stale Jobs": { fr: "Jobs obsolètes", es: "Trabajos obsoletos", ar: "مهام قديمة", zh: "过期任务", ff: "Golle ɓooyɗe" },
  "Marketplace Orders": { fr: "Commandes marketplace", es: "Pedidos marketplace", ar: "طلبات السوق", zh: "商城订单", ff: "Yamirooje marketplace" },
  "Marketplace Dispatch": { fr: "Dispatch marketplace", es: "Despacho marketplace", ar: "توزيع السوق", zh: "商城调度", ff: "Dispatch marketplace" },
  "Marketplace Shadow": { fr: "Shadow marketplace", es: "Shadow marketplace", ar: "ظل السوق", zh: "商城影子模式", ff: "Shadow marketplace" },
  "Marketplace Payouts": { fr: "Payouts marketplace", es: "Pagos marketplace", ar: "مدفوعات السوق", zh: "商城结算", ff: "Payouts marketplace" },
  Partners: { fr: "Partenaires", es: "Socios", ar: "الشركاء", zh: "合作伙伴", ff: "Sehilaaɓe" },
  Customers: { fr: "Clients", es: "Clientes", ar: "العملاء", zh: "客户", ff: "Kiliyaŋke" },
  Drivers: { fr: "Chauffeurs", es: "Conductores", ar: "السائقون", zh: "司机", ff: "Dogooɓe" },
  "Taxi Drivers": { fr: "Chauffeurs taxi", es: "Conductores taxi", ar: "سائقو التاكسي", zh: "出租车司机", ff: "Dogooɓe taksi" },
  "Driver Vehicles": { fr: "Véhicules chauffeurs", es: "Vehículos de conductores", ar: "مركبات السائقين", zh: "司机车辆", ff: "Otooji dogooɓe" },
  "Taxi Driver Quality": { fr: "Qualité chauffeurs taxi", es: "Calidad conductores taxi", ar: "جودة سائقي التاكسي", zh: "出租车司机质量", ff: "Kalite dogooɓe taksi" },
  "Driver Identity": { fr: "Identité chauffeur", es: "Identidad del conductor", ar: "هوية السائق", zh: "司机身份", ff: "Neɗɗankaagal dogoowo" },
  "Stripe Identity": { fr: "Stripe Identity", es: "Stripe Identity", ar: "Stripe Identity", zh: "Stripe Identity", ff: "Stripe Identity" },
  Restaurants: { fr: "Restaurants", es: "Restaurantes", ar: "المطاعم", zh: "餐厅", ff: "Restoraŋji" },
  "Restaurant Automation": { fr: "Automatisation restaurant", es: "Automatización restaurante", ar: "أتمتة المطعم", zh: "餐厅自动化", ff: "Otomatisaasiyoŋ restoraŋ" },
  Sellers: { fr: "Vendeurs", es: "Vendedores", ar: "البائعون", zh: "卖家", ff: "Jeeyooɓe" },
  Finance: { fr: "Finance", es: "Finanzas", ar: "المالية", zh: "财务", ff: "Kaalis" },
  "Finance Hub": { fr: "Hub finance", es: "Hub finanzas", ar: "مركز المالية", zh: "财务中心", ff: "Hub kaalis" },
  Payments: { fr: "Paiements", es: "Pagos", ar: "المدفوعات", zh: "支付", ff: "Njoɓdi" },
  Payouts: { fr: "Payouts", es: "Pagos salientes", ar: "المدفوعات الصادرة", zh: "打款", ff: "Payouts" },
  "Sunday eligibility": {
    fr: "Éligibilité dimanche",
    es: "Elegibilidad domingo",
    ar: "أهلية الأحد",
    zh: "周日打款资格",
    ff: "Jeytaare ala",
  },
  Commissions: { fr: "Commissions", es: "Comisiones", ar: "العمولات", zh: "佣金", ff: "Komisiyoŋji" },
  Pricing: { fr: "Tarification", es: "Precios", ar: "التسعير", zh: "定价", ff: "Njoɓdi njaru" },
  "Taxi Pricing": { fr: "Tarifs taxi", es: "Precios taxi", ar: "تسعير التاكسي", zh: "出租车定价", ff: "Njoɓdi taksi" },
  "Taxi Taxes": { fr: "Taxes taxi", es: "Impuestos taxi", ar: "الضرائب", zh: "出租车税费", ff: "Taxes taksi" },
  "Taxi Exchange Rates": { fr: "Taux de change taxi", es: "Tipos de cambio taxi", ar: "أسعار صرف التاكسي", zh: "出租车汇率", ff: "Njaru mbayliigu taksi" },
  "Payment Methods": { fr: "Moyens de paiement", es: "Métodos de pago", ar: "طرق الدفع", zh: "支付方式", ff: "Laabi njoɓdi" },
  "Payout Methods": { fr: "Moyens de payout", es: "Métodos de payout", ar: "طرق الصرف", zh: "打款方式", ff: "Laabi payout" },
  Loyalty: { fr: "Fidélité", es: "Fidelización", ar: "الولاء", zh: "忠诚度", ff: "Loyalty" },
  "Taxi Loyalty": { fr: "Fidélité taxi", es: "Fidelización taxi", ar: "ولاء التاكسي", zh: "出租车忠诚度", ff: "Loyalty taksi" },
  "Taxi Rewards": { fr: "Récompenses taxi", es: "Recompensas taxi", ar: "مكافآت التاكسي", zh: "出租车奖励", ff: "Njeñtudi taksi" },
  Subscriptions: { fr: "Abonnements", es: "Suscripciones", ar: "الاشتراكات", zh: "订阅", ff: "Abonnementji" },
  "MMD Plus": { fr: "MMD Plus", es: "MMD Plus", ar: "MMD Plus", zh: "MMD Plus", ff: "MMD Plus" },
  Safety: { fr: "Sécurité", es: "Seguridad", ar: "السلامة", zh: "安全", ff: "Hisnol" },
  "Road Safety": { fr: "Sécurité routière", es: "Seguridad vial", ar: "سلامة الطرق", zh: "道路安全", ff: "Hisnol laawol" },
  Recordings: { fr: "Enregistrements", es: "Grabaciones", ar: "التسجيلات", zh: "录音", ff: "Nawnaaɗe" },
  Audit: { fr: "Audit", es: "Auditoría", ar: "التدقيق", zh: "审计", ff: "Audit" },
  Support: { fr: "Support", es: "Soporte", ar: "الدعم", zh: "支持", ff: "Ballal" },
  Chats: { fr: "Chats", es: "Chats", ar: "المحادثات", zh: "聊天", ff: "Yeewtere" },
  Calls: { fr: "Appels", es: "Llamadas", ar: "المكالمات", zh: "通话", ff: "Noddaali" },
  Notify: { fr: "Notifications", es: "Notificar", ar: "إشعارات", zh: "通知", ff: "Tintine" },
  Launch: { fr: "Lancement", es: "Lanzamiento", ar: "الإطلاق", zh: "上线", ff: "Fuɗɗagol" },
  Platform: { fr: "Plateforme", es: "Plataforma", ar: "المنصة", zh: "平台", ff: "Platform" },
  Counties: { fr: "Comtés", es: "Condados", ar: "المقاطعات", zh: "县区", ff: "Diiwanji" },
  Countries: { fr: "Pays", es: "Países", ar: "الدول", zh: "国家", ff: "Leyɗe" },
  "Taxi Launch": { fr: "Lancement taxi", es: "Lanzamiento taxi", ar: "إطلاق التاكسي", zh: "出租车上线", ff: "Fuɗɗagol taksi" },
  "Taxi Monitoring": { fr: "Monitoring taxi", es: "Monitoreo taxi", ar: "مراقبة التاكسي", zh: "出租车监控", ff: "Rewindowal taksi" },
  "MMD AI": { fr: "MMD AI", es: "MMD AI", ar: "MMD AI", zh: "MMD AI", ff: "MMD AI" },
  "Launch Control": { fr: "Contrôle de lancement", es: "Control de lanzamiento", ar: "التحكم بالإطلاق", zh: "上线控制", ff: "Njiyloto fuɗɗagol" },
  Administration: { fr: "Administration", es: "Administración", ar: "الإدارة", zh: "管理", ff: "Njuɓɓudi" },
  Administrators: { fr: "Administrateurs", es: "Administradores", ar: "المسؤولون", zh: "管理员", ff: "Njiylotooɓe" },
  "Teams & Organization": { fr: "Équipes & organisation", es: "Equipos y organización", ar: "الفرق والتنظيم", zh: "团队与组织", ff: "Kippeeji & njuɓɓudi" },
  Tasks: { fr: "Tâches", es: "Tareas", ar: "المهام", zh: "任务", ff: "Golle" },
  Analytics: { fr: "Analytique", es: "Analítica", ar: "التحليلات", zh: "分析", ff: "Analytics" },
  Marketing: { fr: "Marketing", es: "Marketing", ar: "التسويق", zh: "营销", ff: "Marketing" },
  Advertisements: { fr: "Publicités", es: "Anuncios", ar: "الإعلانات", zh: "广告", ff: "Advertisements" },
  "Corporate Website": { fr: "Site corporate", es: "Sitio corporativo", ar: "الموقع المؤسسي", zh: "企业网站", ff: "Lowre korporatif" },
  "Test Records": { fr: "Enregistrements de test", es: "Registros de prueba", ar: "سجلات الاختبار", zh: "测试记录", ff: "Nawnaaɗe test" },
};

const SHELL: Record<string, Record<Exclude<WebLocale, "en">, string>> = {
  "admin.shell.signedIn": { fr: "Connecté", es: "Conectado", ar: "تم تسجيل الدخول", zh: "已登录", ff: "Seŋii" },
  "admin.shell.signOut": { fr: "Déconnexion", es: "Cerrar sesión", ar: "تسجيل الخروج", zh: "退出登录", ff: "Seŋto" },
  "admin.shell.search": { fr: "Rechercher des modules…", es: "Buscar módulos…", ar: "البحث في الوحدات…", zh: "搜索模块…", ff: "Yiylo moduli…" },
  "admin.shell.searchLabel": { fr: "Rechercher des modules", es: "Buscar módulos", ar: "البحث في الوحدات", zh: "搜索模块", ff: "Yiylo moduli" },
  "admin.shell.openMenu": { fr: "Ouvrir le menu", es: "Abrir menú", ar: "فتح القائمة", zh: "打开菜单", ff: "Uddit menu" },
  "admin.shell.closeMenu": { fr: "Fermer le menu", es: "Cerrar menú", ar: "إغلاق القائمة", zh: "关闭菜单", ff: "Uddu menu" },
  "admin.shell.expandSidebar": { fr: "Développer la barre latérale", es: "Expandir barra lateral", ar: "توسيع الشريط الجانبي", zh: "展开侧边栏", ff: "Mawnin sidebar" },
  "admin.shell.collapseSidebar": { fr: "Réduire la barre latérale", es: "Contraer barra lateral", ar: "طي الشريط الجانبي", zh: "收起侧边栏", ff: "Ustu sidebar" },
  "admin.shell.navLabel": { fr: "Navigation Control Center", es: "Navegación Control Center", ar: "تنقل مركز التحكم", zh: "控制中心导航", ff: "Navigation Control Center" },
  "admin.shell.sectionsLabel": { fr: "Sections admin", es: "Secciones admin", ar: "أقسام الإدارة", zh: "管理分区", ff: "Taƴe admin" },
  "admin.shell.controlTitle": { fr: "MMD Control", es: "MMD Control", ar: "MMD Control", zh: "MMD Control", ff: "MMD Control" },
  "admin.shell.language": { fr: "Langue", es: "Idioma", ar: "اللغة", zh: "语言", ff: "Ɗemngal" },
};

export function adminNavLabel(englishLabel: string, locale: WebLocale): string {
  if (locale === "en") return englishLabel;
  return NAV[englishLabel]?.[locale] ?? englishLabel;
}

export function adminShellT(key: string, locale: WebLocale, fallbackEn: string): string {
  if (locale === "en") return fallbackEn;
  return SHELL[key]?.[locale] ?? fallbackEn;
}

export function listAdminNavEnglishLabels(): string[] {
  return Object.keys(NAV);
}
