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
];
