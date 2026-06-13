import type { AdminPermission } from "@/lib/adminRbac";

export type AdminHubLink = {
  href: string;
  title: string;
  description: string;
  permission: AdminPermission;
};

export const ADMIN_HUB_LINKS: AdminHubLink[] = [
  {
    href: "/admin/supervision",
    title: "Supervision",
    description: "Chauffeurs actifs, commandes en attente, erreurs dispatch/payout",
    permission: "supervision.read",
  },
  {
    href: "/admin/clients",
    title: "Clients",
    description: "Parcourir et rechercher tous les clients",
    permission: "users.clients.read",
  },
  {
    href: "/admin/drivers",
    title: "Chauffeurs",
    description: "Approuver, refuser, suspendre les chauffeurs",
    permission: "users.drivers.read",
  },
  {
    href: "/admin/restaurants",
    title: "Restaurants",
    description: "Approuver, refuser, suspendre les restaurants",
    permission: "users.restaurants.read",
  },
  {
    href: "/admin/sellers",
    title: "Marketplace Sellers",
    description: "Approuver, refuser, suspendre les vendeurs marketplace",
    permission: "users.sellers.read",
  },
  {
    href: "/admin/marketplace-orders",
    title: "Marketplace Orders",
    description: "Drafts et pending checkout marketplace (shadow, sans payout)",
    permission: "users.sellers.read",
  },
  {
    href: "/admin/marketplace-delivery-shadow",
    title: "Marketplace Delivery Shadow",
    description: "Quotes livraison marketplace simulées — sans dispatch live",
    permission: "users.sellers.read",
  },
  {
    href: "/admin/marketplace-dispatch",
    title: "Marketplace Dispatch",
    description: "Jobs dispatch marketplace après paiement — OFF par défaut",
    permission: "users.sellers.read",
  },
  {
    href: "/admin/marketplace-payouts",
    title: "Marketplace Payouts",
    description: "Ledgers vendeur/chauffeur marketplace — sans transfert live",
    permission: "users.sellers.read",
  },
  {
    href: "/admin/admins",
    title: "Administrateurs",
    description: "Gérer les rôles staff (Super Admin uniquement)",
    permission: "users.admins.manage",
  },
  {
    href: "/admin/orders",
    title: "Commandes food",
    description: "Food orders, timeline, paiements et commissions",
    permission: "orders.read",
  },
  {
    href: "/admin/delivery-requests",
    title: "Delivery Requests",
    description: "Demandes de livraison et statuts paiement",
    permission: "delivery_requests.read",
  },
  {
    href: "/admin/driver-offers",
    title: "Driver Offers",
    description: "Offres chauffeurs (food + delivery requests)",
    permission: "driver_offers.read",
  },
  {
    href: "/admin/dispatch",
    title: "Dispatch",
    description: "Vagues dispatch, relances et commandes actives",
    permission: "dispatch.read",
  },
  {
    href: "/admin/payouts",
    title: "Payouts",
    description: "Paiements restaurant/chauffeur, retries et audit",
    permission: "payouts.read",
  },
  {
    href: "/admin/stripe",
    title: "Stripe",
    description: "Webhooks, PaymentIntents et monitoring sync",
    permission: "payments.read",
  },
  {
    href: "/admin/communication",
    title: "Communication",
    description: "Push, SMS, email — journalisé",
    permission: "communication.notify",
  },
  {
    href: "/admin/chats",
    title: "Chats",
    description: "Conversations commandes et support",
    permission: "communication.chats",
  },
  {
    href: "/admin/calls",
    title: "Appels",
    description: "Sessions d'appel liées aux commandes",
    permission: "communication.calls",
  },
  {
    href: "/admin/audit",
    title: "Audit",
    description: "Journal complet des actions administrateur",
    permission: "audit.read",
  },
  {
    href: "/admin/pricing",
    title: "Pricing",
    description: "Commissions, frais, promos — sans redéploiement",
    permission: "pricing.read",
  },
  {
    href: "/admin/taxi-rides",
    title: "Taxi Rides",
    description: "Courses taxi, timeline, remboursements admin",
    permission: "taxi_rides.read",
  },
  {
    href: "/admin/taxi-pricing",
    title: "Taxi Pricing",
    description: "Tarifs standard / XL / premium",
    permission: "taxi_pricing.read",
  },
  {
    href: "/admin/taxi-drivers",
    title: "Taxi Drivers",
    description: "Chauffeurs taxi, classes véhicule et éligibilité",
    permission: "taxi_drivers.read",
  },
  {
    href: "/admin/taxi-promotions",
    title: "Taxi Promotions",
    description: "Codes promo taxi — pourcentage, fixe, first ride",
    permission: "taxi_promotions.read",
  },
  {
    href: "/admin/taxi-loyalty",
    title: "Taxi Loyalty",
    description: "Programme fidélité taxi — consultation et ajustements",
    permission: "taxi_rides.read",
  },
  {
    href: "/admin/taxi-scheduled",
    title: "Taxi Scheduled",
    description: "Réservations taxi à l'avance — dispatch et annulations",
    permission: "taxi_rides.read",
  },
  {
    href: "/admin/taxi-loyalty-rewards",
    title: "Taxi Rewards",
    description: "Récompenses fidélité taxi — crédits et points",
    permission: "taxi_rides.read",
  },
  {
    href: "/admin/taxi-shared-rides",
    title: "Taxi Shared Rides",
    description: "Partage de trajet taxi — matching et passagers",
    permission: "taxi_shared_rides.read",
  },
  {
    href: "/admin/taxi-business-accounts",
    title: "Taxi Business",
    description: "Comptes entreprise taxi — membres et dépenses",
    permission: "taxi_business.read",
  },
  {
    href: "/admin/taxi-driver-quality",
    title: "Taxi Driver Quality",
    description: "Scores qualité chauffeurs — premium promote/demote",
    permission: "taxi_driver_quality.read",
  },
  {
    href: "/admin/taxi-countries",
    title: "Taxi Countries",
    description: "Pays actifs, devise, langue, fuseau horaire",
    permission: "taxi_countries.read",
  },
  {
    href: "/admin/taxi-taxes",
    title: "Taxi Taxes",
    description: "Taxes par pays — TVA, sales tax placeholders",
    permission: "taxi_taxes.read",
  },
  {
    href: "/admin/taxi-exchange-rates",
    title: "Taxi Exchange Rates",
    description: "Taux de change de référence (display/analytics)",
    permission: "taxi_exchange_rates.read",
  },
  {
    href: "/admin/taxi-monitoring",
    title: "Taxi Monitoring",
    description: "Santé ops, KPI business, alertes dispatch/payment/payout",
    permission: "taxi_monitoring.read",
  },
  {
    href: "/admin/taxi-launch",
    title: "Taxi Launch Control",
    description: "Activation marchés et features par pays sans redéploiement",
    permission: "taxi_launch.read",
  },
  {
    href: "/admin/platform-launch",
    title: "Platform Launch Control",
    description: "Activation globale plateforme par pays — taxi, delivery, restaurant",
    permission: "platform_launch.read",
  },
  {
    href: "/admin/mmd-ai",
    title: "MMD AI",
    description: "AI usage, costs, safety and monitoring",
    permission: "mmd_ai.read",
  },
  {
    href: "/admin/mmd-ai/launch",
    title: "MMD AI Launch Control",
    description: "Enable or disable AI by country, state, region or city",
    permission: "mmd_ai.read",
  },
];
