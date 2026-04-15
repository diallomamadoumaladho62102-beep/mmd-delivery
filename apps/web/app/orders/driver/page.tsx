"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseBrowser";
import { computeDriverPay } from "@/lib/deliveryPricing";

type OrderStatus =
  | "pending"
  | "accepted"
  | "prepared"
  | "ready"
  | "dispatched"
  | "delivered"
  | "canceled";

type OrderRow = {
  id: string;
  status: OrderStatus;
  created_at: string;
  restaurant_name: string | null;
  currency: string | null;
  subtotal: number | null;
  total: number | null;
  distance_miles?: number | null;
  eta_minutes?: number | null;
  delivery_fee?: number | null;
};

type Me = {
  id: string;
  full_name: string | null;
};

type MemberRow = {
  order_id: string;
  user_id: string;
  role: string;
};

type ClientProfile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
};

type DriverProfile = {
  user_id: string;
  full_name: string | null;
  transport_mode: string | null;
  status: string | null;
  documents_required: boolean;
  is_online: boolean;
  missing_requirements: string | null;
};

const ACTIVE_STATUSES: OrderStatus[] = [
  "pending",
  "accepted",
  "prepared",
  "ready",
  "dispatched",
];

function driverStatusLabel(s: OrderStatus): string {
  switch (s) {
    case "pending":
      return "En attente (envoi au restaurant)";
    case "accepted":
      return "Acceptée (chez le restaurant)";
    case "prepared":
      return "En préparation";
    case "ready":
      return "Prête (en attente du driver)";
    case "dispatched":
      return "En livraison";
    case "delivered":
      return "Livrée";
    case "canceled":
      return "Annulée";
    default:
      return s;
  }
}

function getAvatarSrc(url: string | null): string | null {
  if (!url) return null;
  const u = url.trim();
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  return null;
}

function parseMissingRequirements(value: string | null | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  const withoutPrefix = trimmed.replace(/^Missing:\s*/i, "");
  return withoutPrefix
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function transportModeLabel(value: string | null | undefined): string {
  if (value === "bike") return "Bike";
  if (value === "moto") return "Moto";
  if (value === "car") return "Car";
  return "—";
}

export default function DriverOrdersDashboardPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [driverProfile, setDriverProfile] = useState<DriverProfile | null>(null);
  const [available, setAvailable] = useState<OrderRow[]>([]);
  const [mine, setMine] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [clientByOrder, setClientByOrder] = useState<
    Record<string, ClientProfile | null>
  >({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const mustCompleteProfile =
    driverProfile?.status === "approved" &&
    driverProfile?.documents_required === true;

  const isApproved = driverProfile?.status === "approved";
  const canAccessDriverWork =
    driverProfile?.status === "approved" &&
    driverProfile?.documents_required === false;

  const missingRequirements = useMemo(
    () => parseMissingRequirements(driverProfile?.missing_requirements),
    [driverProfile?.missing_requirements],
  );

  async function load() {
    setLoading(true);
    setErr(null);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) {
      console.error(userError);
      setErr(userError.message);
      setLoading(false);
      return;
    }

    const user = userData.user;
    if (!user) {
      setErr(
        "Tu dois te connecter en tant que chauffeur pour voir ce tableau de bord.",
      );
      setLoading(false);
      return;
    }

    const uid = user.id;

    const [
      { data: profileRow, error: profileError },
      { data: driverRow, error: driverError },
    ] = await Promise.all([
      supabase.from("profiles").select("id, full_name").eq("id", uid).maybeSingle(),
      supabase
        .from("driver_profiles")
        .select(
          "user_id, full_name, transport_mode, status, documents_required, is_online, missing_requirements",
        )
        .eq("user_id", uid)
        .maybeSingle(),
    ]);

    if (!profileError && profileRow) {
      setMe({
        id: profileRow.id,
        full_name: profileRow.full_name ?? null,
      });
    } else {
      setMe({ id: uid, full_name: user.email ?? null });
    }

    if (driverError) {
      console.error(driverError);
      setErr(driverError.message);
      setLoading(false);
      return;
    }

    setDriverProfile((driverRow as DriverProfile | null) ?? null);

    if (!driverRow) {
      setAvailable([]);
      setMine([]);
      setClientByOrder({});
      setLoading(false);
      return;
    }

    if (driverRow.status !== "approved" || driverRow.documents_required === true) {
      setAvailable([]);
      setMine([]);
      setClientByOrder({});
      setLoading(false);
      return;
    }

    const { data: ordersData, error: ordersError } = await supabase
      .from("orders")
      .select(
        `
        id,
        status,
        created_at,
        restaurant_name,
        currency,
        subtotal,
        total,
        distance_miles,
        eta_minutes,
        delivery_fee
      `,
      )
      .in("status", ACTIVE_STATUSES)
      .order("created_at", { ascending: false });

    if (ordersError) {
      console.error(ordersError);
      setErr(ordersError.message);
      setLoading(false);
      return;
    }

    const allOrders = (ordersData || []) as OrderRow[];
    const orderIds = allOrders.map((o) => o.id);

    if (orderIds.length === 0) {
      setAvailable([]);
      setMine([]);
      setClientByOrder({});
      setLoading(false);
      return;
    }

    const { data: membersData, error: membersError } = await supabase
      .from("order_members")
      .select("order_id, user_id, role")
      .in("order_id", orderIds);

    if (membersError) {
      console.error(membersError);
      setErr(membersError.message);
      setLoading(false);
      return;
    }

    const members = (membersData || []) as MemberRow[];

    const mineOrders = allOrders.filter((o) =>
      members.some(
        (m) =>
          m.order_id === o.id &&
          m.role === "driver" &&
          m.user_id === uid &&
          o.status !== "delivered" &&
          o.status !== "canceled",
      ),
    );

    const availableOrders = allOrders.filter(
      (o) =>
        o.status !== "delivered" &&
        o.status !== "canceled" &&
        !members.some((m) => m.order_id === o.id && m.role === "driver"),
    );

    setMine(mineOrders);
    setAvailable(availableOrders);

    const clientMembers = members.filter((m) => m.role === "client");
    const clientIds = Array.from(new Set(clientMembers.map((m) => m.user_id)));

    if (clientIds.length === 0) {
      setClientByOrder({});
      setLoading(false);
      return;
    }

    const { data: clientProfilesData, error: clientProfilesError } =
      await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", clientIds);

    if (clientProfilesError || !clientProfilesData) {
      console.error(clientProfilesError);
      setClientByOrder({});
      setLoading(false);
      return;
    }

    const profilesMap = new Map<string, ClientProfile>();
    for (const p of clientProfilesData) {
      profilesMap.set(p.id, {
        id: p.id,
        full_name: p.full_name ?? null,
        avatar_url: p.avatar_url ?? null,
      });
    }

    const byOrder: Record<string, ClientProfile | null> = {};
    for (const m of clientMembers) {
      byOrder[m.order_id] = profilesMap.get(m.user_id) ?? null;
    }

    setClientByOrder(byOrder);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  function formatDate(iso: string) {
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch {
      return iso;
    }
  }

  function formatDistance(order: OrderRow): string {
    if (typeof order.distance_miles === "number") {
      return `${order.distance_miles.toFixed(1)} mi`;
    }
    return "—";
  }

  function formatEta(order: OrderRow): string {
    if (typeof order.eta_minutes === "number") {
      return `${order.eta_minutes} min`;
    }
    return "—";
  }

  function formatDriverShare(order: OrderRow): string {
    if (order.delivery_fee == null) return "—";
    const driverPay = computeDriverPay(order.delivery_fee);
    const cur = order.currency || "USD";
    return `${driverPay.toFixed(2)} ${cur}`;
  }

  async function acceptOrder(orderId: string) {
    if (!canAccessDriverWork) {
      alert(
        "Ton compte chauffeur n'est pas encore autorisé à recevoir des courses. Merci de compléter ton profil chauffeur.",
      );
      return;
    }

    setActionLoading(orderId);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        alert("Tu dois être connecté pour accepter une course.");
        return;
      }

      const { error } = await supabase.rpc("join_order", {
        p_order_id: orderId,
        p_role: "driver",
      });

      if (error) {
        alert(error.message);
        return;
      }

      await load();
    } finally {
      setActionLoading(null);
    }
  }

  async function rejectOrder(orderId: string) {
    if (!canAccessDriverWork) {
      alert(
        "Ton compte chauffeur n'est pas encore autorisé à traiter des courses.",
      );
      return;
    }

    const ok = window.confirm(
      "Tu ne veux pas effectuer cette course ? Elle restera disponible pour d'autres chauffeurs.",
    );
    if (!ok) return;

    alert("Course refusée. Tu peux en choisir une autre.");
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tableau de bord chauffeur</h1>
          <p className="text-sm text-gray-600">
            Connecté en tant que{" "}
            <span className="font-medium">
              {me?.full_name || "Ton compte chauffeur"}
            </span>
            .
          </p>
          <p className="text-xs text-gray-500">
            Liste des courses disponibles et de tes livraisons en cours.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void load()}
          className="px-3 py-1.5 rounded-lg border text-sm bg-white hover:bg-gray-50"
        >
          Rafraîchir
        </button>
      </header>

      {driverProfile && (
        <section className="rounded-xl border bg-white p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-semibold">Statut chauffeur</p>
              <p className="text-xs text-gray-600">
                Mode :{" "}
                <span className="font-medium">
                  {transportModeLabel(driverProfile.transport_mode)}
                </span>
              </p>
              <p className="text-xs text-gray-600">
                Validation :{" "}
                <span className="font-medium">{driverProfile.status || "—"}</span>
              </p>
              <p className="text-xs text-gray-600">
                Dossier requis :{" "}
                <span className="font-medium">
                  {driverProfile.documents_required ? "oui" : "non"}
                </span>
              </p>
              <p className="text-xs text-gray-600">
                Disponibilité :{" "}
                <span className="font-medium">
                  {driverProfile.is_online ? "en ligne" : "hors ligne"}
                </span>
              </p>
            </div>

            <div>
              {canAccessDriverWork ? (
                <span className="inline-flex items-center px-3 py-1 rounded-full border text-xs font-semibold bg-emerald-50 text-emerald-700 border-emerald-200">
                  Compte prêt à recevoir des courses
                </span>
              ) : mustCompleteProfile ? (
                <span className="inline-flex items-center px-3 py-1 rounded-full border text-xs font-semibold bg-amber-50 text-amber-700 border-amber-200">
                  Profil à compléter
                </span>
              ) : !isApproved ? (
                <span className="inline-flex items-center px-3 py-1 rounded-full border text-xs font-semibold bg-blue-50 text-blue-700 border-blue-200">
                  En attente d’approbation
                </span>
              ) : (
                <span className="inline-flex items-center px-3 py-1 rounded-full border text-xs font-semibold bg-gray-50 text-gray-700 border-gray-200">
                  Accès limité
                </span>
              )}
            </div>
          </div>
        </section>
      )}

      {loading && (
        <p className="text-sm text-gray-600">
          Chargement des courses en cours…
        </p>
      )}

      {err && <p className="text-sm text-red-600">Erreur : {err}</p>}

      {!loading && !err && !driverProfile && (
        <section className="rounded-xl border bg-white p-5 space-y-3">
          <h2 className="text-lg font-semibold">Profil chauffeur introuvable</h2>
          <p className="text-sm text-gray-600">
            Ton compte n’a pas encore de fiche dans <code>driver_profiles</code>.
          </p>
          <Link
            href="/signup/driver"
            className="inline-flex px-3 py-2 rounded-lg bg-black text-white text-sm"
          >
            Compléter mon profil chauffeur
          </Link>
        </section>
      )}

      {!loading && !err && driverProfile && mustCompleteProfile && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 space-y-4">
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-amber-800">
              Profil chauffeur incomplet
            </h2>
            <p className="text-sm text-amber-700">
              Your driver account is approved, but your profile is incomplete.
              Please upload the missing information and documents to go online.
            </p>
            <p className="text-sm text-amber-700">
              Tant que ton dossier n’est pas complet, tu ne peux pas accepter de
              nouvelles courses.
            </p>
          </div>

          {missingRequirements.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-white p-4">
              <p className="text-sm font-semibold text-amber-800 mb-3">
                Éléments à compléter
              </p>
              <ul className="space-y-2">
                {missingRequirements.map((item) => (
                  <li
                    key={item}
                    className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <Link
              href="/signup/driver"
              className="inline-flex px-4 py-2 rounded-lg bg-black text-white text-sm font-medium"
            >
              Compléter mon profil chauffeur
            </Link>
          </div>
        </section>
      )}

      {!loading && !err && driverProfile && !isApproved && (
        <section className="rounded-xl border border-blue-200 bg-blue-50 p-5 space-y-3">
          <h2 className="text-lg font-semibold text-blue-800">
            Compte chauffeur en attente
          </h2>
          <p className="text-sm text-blue-700">
            Ton compte chauffeur existe bien, mais il n’est pas encore approuvé.
          </p>
          <p className="text-sm text-blue-700">
            Tu pourras recevoir des courses après validation de ton dossier.
          </p>
          <Link
            href="/signup/driver"
            className="inline-flex px-3 py-2 rounded-lg bg-black text-white text-sm"
          >
            Voir mon dossier chauffeur
          </Link>
        </section>
      )}

      {!loading && !err && canAccessDriverWork && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Courses à accepter</h2>
            <p className="text-xs text-gray-500">
              Commandes prêtes ou en cours sans driver assigné.
            </p>
          </div>

          {available.length === 0 ? (
            <p className="text-sm text-gray-600">
              Aucune course disponible pour le moment.
            </p>
          ) : (
            <div className="space-y-3">
              {available.map((order) => {
                const shortId = order.id.slice(0, 8);
                const client = clientByOrder[order.id] ?? null;
                const avatarSrc = client
                  ? getAvatarSrc(client.avatar_url)
                  : null;

                return (
                  <article
                    key={order.id}
                    className="border rounded-xl bg-white p-4 flex flex-col gap-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">
                          Commande #{shortId}
                        </p>
                        <p className="text-xs text-gray-500">
                          Créée le {formatDate(order.created_at)}
                        </p>
                        {order.restaurant_name && (
                          <p className="text-xs text-gray-600">
                            Restaurant :{" "}
                            <span className="font-medium">
                              {order.restaurant_name}
                            </span>
                          </p>
                        )}

                        {client && (
                          <div className="mt-2 flex items-center gap-2">
                            {avatarSrc ? (
                              <img
                                src={avatarSrc}
                                alt={client.full_name ?? "Client"}
                                className="h-8 w-8 rounded-full object-cover"
                              />
                            ) : (
                              <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-semibold">
                                {(client.full_name || "C")
                                  .charAt(0)
                                  .toUpperCase()}
                              </div>
                            )}
                            <span className="text-xs text-gray-700">
                              <span className="text-[11px] text-gray-500 mr-1">
                                Client :
                              </span>
                              <span className="font-medium">
                                {client.full_name ?? "Client MMD"}
                              </span>
                            </span>
                          </div>
                        )}
                      </div>

                      <span className="inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium bg-emerald-50 text-emerald-700 border-emerald-200">
                        {driverStatusLabel(order.status)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-700">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                        <p>
                          <span className="text-gray-500 mr-1">Distance :</span>
                          <span className="font-medium">
                            {formatDistance(order)}
                          </span>
                        </p>
                        <p>
                          <span className="text-gray-500 mr-1">Temps :</span>
                          <span className="font-medium">{formatEta(order)}</span>
                        </p>
                        <p>
                          <span className="text-gray-500 mr-1">
                            Ta part (estimée) :
                          </span>
                          <span className="font-semibold">
                            {formatDriverShare(order)}
                          </span>
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-700">
                      <div className="flex flex-col sm:flex-row gap-2">
                        <button
                          type="button"
                          onClick={() => void acceptOrder(order.id)}
                          disabled={actionLoading === order.id}
                          className="px-3 py-1.5 rounded-lg bg-black text-white text-xs font-semibold hover:bg-gray-900 disabled:opacity-60"
                        >
                          {actionLoading === order.id
                            ? "Traitement..."
                            : "Accepter la course"}
                        </button>

                        <button
                          type="button"
                          onClick={() => void rejectOrder(order.id)}
                          className="px-3 py-1.5 rounded-lg border border-red-500 text-red-600 bg-white hover:bg-red-50 text-xs font-semibold"
                        >
                          Refuser la course
                        </button>

                        <Link
                          href={`/orders/${order.id}/driver`}
                          className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
                        >
                          Détails de la course
                        </Link>

                        <Link
                          href={`/orders/${order.id}/chat`}
                          className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
                        >
                          Ouvrir le chat
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {!loading && !err && canAccessDriverWork && (
        <section className="space-y-3">
          <div className="pt-4 border-t">
            <h2 className="text-lg font-semibold">Mes livraisons en cours</h2>
            <p className="text-xs text-gray-500">
              Courses où tu es déjà assigné en tant que driver.
            </p>
          </div>

          {mine.length === 0 ? (
            <p className="text-sm text-gray-600">
              Tu n&apos;as aucune livraison active pour le moment.
            </p>
          ) : (
            <div className="space-y-3">
              {mine.map((order) => {
                const shortId = order.id.slice(0, 8);
                const client = clientByOrder[order.id] ?? null;
                const avatarSrc = client
                  ? getAvatarSrc(client.avatar_url)
                  : null;

                return (
                  <article
                    key={order.id}
                    className="border rounded-xl bg-white p-4 flex flex-col gap-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">
                          Commande #{shortId}
                        </p>
                        <p className="text-xs text-gray-500">
                          Créée le {formatDate(order.created_at)}
                        </p>
                        {order.restaurant_name && (
                          <p className="text-xs text-gray-600">
                            Restaurant :{" "}
                            <span className="font-medium">
                              {order.restaurant_name}
                            </span>
                          </p>
                        )}

                        {client && (
                          <div className="mt-2 flex items-center gap-2">
                            {avatarSrc ? (
                              <img
                                src={avatarSrc}
                                alt={client.full_name ?? "Client"}
                                className="h-8 w-8 rounded-full object-cover"
                              />
                            ) : (
                              <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-semibold">
                                {(client.full_name || "C")
                                  .charAt(0)
                                  .toUpperCase()}
                              </div>
                            )}
                            <span className="text-xs text-gray-700">
                              <span className="text-[11px] text-gray-500 mr-1">
                                Client :
                              </span>
                              <span className="font-medium">
                                {client.full_name ?? "Client MMD"}
                              </span>
                            </span>
                          </div>
                        )}
                      </div>

                      <span className="inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium bg-blue-50 text-blue-700 border-blue-200">
                        {driverStatusLabel(order.status)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-gray-700">
                      <p>
                        <span className="text-gray-500 mr-1">Distance :</span>
                        <span className="font-medium">
                          {formatDistance(order)}
                        </span>
                      </p>
                      <p>
                        <span className="text-gray-500 mr-1">Temps :</span>
                        <span className="font-medium">{formatEta(order)}</span>
                      </p>
                      <p>
                        <span className="text-gray-500 mr-1">
                          Ta part (estimée) :
                        </span>
                        <span className="font-semibold">
                          {formatDriverShare(order)}
                        </span>
                      </p>
                    </div>

                    <p className="text-xs text-gray-500">
                      Retrouve l&apos;adresse de retrait, l&apos;adresse de dépôt et
                      les instructions du client dans la page de la course.
                    </p>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-700">
                      <div className="flex flex-col sm:flex-row gap-2">
                        <Link
                          href={`/orders/${order.id}/driver`}
                          className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
                        >
                          Voir la course
                        </Link>

                        <Link
                          href={`/orders/${order.id}/chat`}
                          className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
                        >
                          Ouvrir le chat
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </main>
  );
}