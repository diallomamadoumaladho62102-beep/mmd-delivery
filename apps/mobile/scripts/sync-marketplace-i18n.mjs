/**
 * Sync marketplace launch i18n keys from en into fr/es/ar/zh/ff.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(__dirname, "..", "src", "i18n", "locales");

const patches = {
  fr: {
    roleSelect: {
      title: "Choose your mode",
      subtitle: "Choisissez un rôle pour accéder à l'interface correspondante.",
      roles: {
        client: "Client",
        driver: "Chauffeur",
        restaurant: "Restaurant",
        seller: "Vendeur Marketplace",
      },
    },
    marketplace: {
      errors: { unavailable: "Marketplace indisponible dans votre zone." },
      home: {
        emptyOpen: "Aucune boutique approuvée dans votre zone.",
        openCount: "{{open}} ouvertes · {{total}} boutiques",
        shopOpen: "Ouvert",
        shopClosed: "Fermé",
        productCount: "{{count}} produits disponibles",
      },
      products: { shopClosed: "Cette boutique est actuellement fermée." },
    },
    seller: {
      dashboard: {
        approved: "Votre compte vendeur est approuvé. Vous pouvez gérer vos produits.",
        pending: "Votre candidature vendeur est en attente de validation admin.",
        rejected: "Votre candidature vendeur a été refusée. Contactez le support.",
        suspended: "Votre compte vendeur est suspendu. Activité marketplace bloquée.",
        platformOff: "Services vendeur désactivés dans votre région.",
        shopOpenTitle: "Boutique ouverte aux clients",
        shopOpenOn: "Les clients peuvent parcourir vos produits actifs.",
        shopOpenOff: "Votre boutique est fermée aux nouvelles commandes.",
        toggleFailed: "Impossible de mettre à jour le statut boutique.",
      },
      onboarding: {
        submittedBody: "Votre profil vendeur est en attente de validation admin.",
        scopeRequired: "Votre marché doit être résolu avant de postuler.",
      },
    },
    driver: {
      marketplace: {
        status: {
          pending: "En attente",
          ready: "Prêt pour retrait",
          assigned: "Assignée",
          pickedUp: "Colis récupéré",
          delivered: "Livrée",
          cancelled: "Annulée",
        },
        confirmPickup: "Confirmer le retrait marketplace",
        confirmDelivered: "Confirmer la livraison marketplace",
        updateFailed: "Impossible de mettre à jour la livraison marketplace.",
      },
      home: { kind: { marketplace: "Livraison marketplace" } },
    },
  },
  es: {
    roleSelect: {
      title: "Choose your mode",
      subtitle: "Elige un rol para acceder a la interfaz correspondiente.",
      roles: {
        client: "Cliente",
        driver: "Conductor",
        restaurant: "Restaurante",
        seller: "Vendedor Marketplace",
      },
    },
    marketplace: {
      errors: { unavailable: "Marketplace no disponible en tu zona." },
      home: {
        emptyOpen: "No hay tiendas aprobadas en tu zona.",
        openCount: "{{open}} abiertas · {{total}} tiendas",
        shopOpen: "Abierta",
        shopClosed: "Cerrada",
        productCount: "{{count}} productos disponibles",
      },
      products: { shopClosed: "Esta tienda está cerrada." },
    },
    seller: {
      dashboard: {
        approved: "Tu cuenta vendedor está aprobada. Puedes gestionar productos.",
        pending: "Tu solicitud vendedor está pendiente de revisión.",
        rejected: "Tu solicitud vendedor fue rechazada. Contacta soporte.",
        suspended: "Tu cuenta vendedor está suspendida.",
        platformOff: "Servicios vendedor desactivados en tu región.",
        shopOpenTitle: "Tienda abierta a clientes",
        shopOpenOn: "Los clientes pueden ver tus productos activos.",
        shopOpenOff: "Tu tienda está cerrada a nuevos pedidos.",
        toggleFailed: "No se pudo actualizar el estado de la tienda.",
      },
      onboarding: {
        submittedBody: "Tu perfil vendedor está pendiente de revisión admin.",
        scopeRequired: "Tu mercado debe resolverse antes de aplicar.",
      },
    },
    driver: {
      marketplace: {
        status: {
          pending: "Pendiente",
          ready: "Lista para recoger",
          assigned: "Asignada",
          pickedUp: "Recogida",
          delivered: "Entregada",
          cancelled: "Cancelada",
        },
        confirmPickup: "Confirmar recogida marketplace",
        confirmDelivered: "Confirmar entrega marketplace",
        updateFailed: "No se pudo actualizar la entrega marketplace.",
      },
      home: { kind: { marketplace: "Entrega marketplace" } },
    },
  },
  ar: {
    roleSelect: {
      title: "Choose your mode",
      subtitle: "اختر دورًا للوصول إلى الواجهة المناسبة.",
      roles: {
        client: "عميل",
        driver: "سائق",
        restaurant: "مطعم",
        seller: "بائع Marketplace",
      },
    },
    marketplace: {
      errors: { unavailable: "السوق غير متاح في منطقتك." },
      home: {
        emptyOpen: "لا توجد متاجر معتمدة في منطقتك.",
        openCount: "{{open}} مفتوحة · {{total}} متاجر",
        shopOpen: "مفتوح",
        shopClosed: "مغلق",
        productCount: "{{count}} منتجات متاحة",
      },
      products: { shopClosed: "هذا المتجر مغلق حاليًا." },
    },
    seller: {
      dashboard: {
        approved: "حساب البائع معتمد. يمكنك إدارة المنتجات.",
        pending: "طلب البائع قيد مراجعة الإدارة.",
        rejected: "تم رفض طلب البائع. تواصل مع الدعم.",
        suspended: "حساب البائع موقوف.",
        platformOff: "خدمات البائع معطلة في منطقتك.",
        shopOpenTitle: "المتجر مفتوح للعملاء",
        shopOpenOn: "يمكن للعملاء تصفح منتجاتك النشطة.",
        shopOpenOff: "متجرك مغلق للطلبات الجديدة.",
        toggleFailed: "تعذر تحديث حالة المتجر.",
      },
      onboarding: {
        submittedBody: "ملف البائع قيد مراجعة الإدارة.",
        scopeRequired: "يجب تحديد السوق قبل التقديم.",
      },
    },
    driver: {
      marketplace: {
        status: {
          pending: "قيد الانتظار",
          ready: "جاهز للاستلام",
          assigned: "مُسند",
          pickedUp: "تم الاستلام",
          delivered: "تم التسليم",
          cancelled: "ملغى",
        },
        confirmPickup: "تأكيد استلام Marketplace",
        confirmDelivered: "تأكيد تسليم Marketplace",
        updateFailed: "تعذر تحديث توصيل Marketplace.",
      },
      home: { kind: { marketplace: "توصيل Marketplace" } },
    },
  },
  zh: {
    roleSelect: {
      title: "Choose your mode",
      subtitle: "选择角色以进入对应界面。",
      roles: {
        client: "客户",
        driver: "司机",
        restaurant: "餐厅",
        seller: "Marketplace 卖家",
      },
    },
    marketplace: {
      errors: { unavailable: "您所在区域暂未开放 Marketplace。" },
      home: {
        emptyOpen: "您所在区域暂无已批准店铺。",
        openCount: "{{open}} 家营业 · 共 {{total}} 家店铺",
        shopOpen: "营业中",
        shopClosed: "已打烊",
        productCount: "{{count}} 件可购商品",
      },
      products: { shopClosed: "该店铺当前未营业。" },
    },
    seller: {
      dashboard: {
        approved: "卖家账户已批准，可管理商品。",
        pending: "卖家申请待管理员审核。",
        rejected: "卖家申请被拒绝，请联系支持。",
        suspended: "卖家账户已暂停。",
        platformOff: "您所在区域卖家服务已关闭。",
        shopOpenTitle: "向客户开放店铺",
        shopOpenOn: "客户可浏览您的在售商品。",
        shopOpenOff: "店铺已关闭，不接受新订单。",
        toggleFailed: "无法更新店铺状态。",
      },
      onboarding: {
        submittedBody: "卖家资料待管理员审核。",
        scopeRequired: "提交前需确定市场范围。",
      },
    },
    driver: {
      marketplace: {
        status: {
          pending: "待处理",
          ready: "可取货",
          assigned: "已分配",
          pickedUp: "已取货",
          delivered: "已送达",
          cancelled: "已取消",
        },
        confirmPickup: "确认 Marketplace 取货",
        confirmDelivered: "确认 Marketplace 送达",
        updateFailed: "无法更新 Marketplace 配送。",
      },
      home: { kind: { marketplace: "Marketplace 配送" } },
    },
  },
  ff: {
    roleSelect: {
      title: "Choose your mode",
      subtitle: "Suɓo renndo ngam yiytude interface maɗɗo.",
      roles: {
        client: "Client",
        driver: "Driver",
        restaurant: "Restaurant",
        seller: "Seller Marketplace",
      },
    },
    marketplace: {
      errors: { unavailable: "Marketplace alaa e nder maɓɓe maa." },
      home: {
        emptyOpen: "Alaa duka jeɗɗii e nder maɓɓe maa.",
        openCount: "{{open}} udditii · {{total}} duka",
        shopOpen: "Udditii",
        shopClosed: "Udditaama",
        productCount: "{{count}} produit ɗi ngal woodi",
      },
      products: { shopClosed: "Duka ngal udditaama." },
    },
    seller: {
      dashboard: {
        approved: "Account seller jaɓii. A waawi huutoraade produit.",
        pending: "Application seller ngartii e admin.",
        rejected: "Application seller hollii. Contact support.",
        suspended: "Account seller daaƴaa.",
        platformOff: "Service seller daaƴaa e region maa.",
        shopOpenTitle: "Duka udditii e client",
        shopOpenOn: "Client ɗe waawi yiyde produit maa.",
        shopOpenOff: "Duka maa udditaama e order ɗe kesii.",
        toggleFailed: "Alaa update status duka.",
      },
      onboarding: {
        submittedBody: "Profile seller ngartii e admin.",
        scopeRequired: "Market foti resolvaade adii apply.",
      },
    },
    driver: {
      marketplace: {
        status: {
          pending: "Pending",
          ready: "Ready for pickup",
          assigned: "Assigned",
          pickedUp: "Picked up",
          delivered: "Delivered",
          cancelled: "Cancelled",
        },
        confirmPickup: "Confirm marketplace pickup",
        confirmDelivered: "Confirm marketplace delivered",
        updateFailed: "Unable to update marketplace delivery.",
      },
      home: { kind: { marketplace: "Marketplace delivery" } },
    },
  },
};

function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      target[key] = deepMerge(target[key] && typeof target[key] === "object" ? target[key] : {}, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

for (const locale of ["fr", "es", "ar", "zh", "ff"]) {
  const filePath = path.join(localesDir, locale, "extras.json");
  const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
  deepMerge(json, patches[locale]);
  fs.writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`, "utf8");
  console.log(`patched ${locale}/extras.json`);
}

console.log("sync-marketplace-i18n.mjs done");
