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

type OrderKind = "pickup_dropoff" | "food" | string;

type OrderRow = {
  id: string;
  kind: OrderKind | null;
  status: OrderStatus;
  created_at: string;
  restaurant_name: string | null;
  currency: string | null;
  subtotal: number | null;
  total: number | null;
  distance_miles?: number | null;
  eta_minutes?: number | null;
  delivery_fee?: number | null;
  driver_id?: string | null;
  pickup_address?: string | null;
  dropoff_address?: string | null;
  client_user_id?: string | null;
  created_by?: string | null;
};

type Me = {
  id: string;
  full_name: string | null;
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
  phone?: string | null;
  emergency_phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  date_of_birth?: string | null;
  vehicle_brand?: string | null;
  vehicle_model?: string | null;
  vehicle_year?: number | null;
  vehicle_color?: string | null;
  plate_number?: string | null;
  license_number?: string | null;
  license_expiry?: string | null;
};

type DriverDocumentType =
  | "profile_photo"
  | "id_card_front"
  | "id_card_back"
  | "license_front"
  | "license_back"
  | "insurance"
  | "registration";

type DriverDocumentStatus = "pending" | "approved" | "rejected";

type DriverDocumentRow = {
  id: string;
  user_id: string;
  doc_type: DriverDocumentType;
  status: DriverDocumentStatus;
};

const ACTIVE_STATUSES: OrderStatus[] = [
  "pending",
  "accepted",
  "prepared",
  "ready",
  "dispatched",
];

function driverStatusLabel(order: OrderRow): string {
  if (order.kind === "pickup_dropoff") {
    switch (order.status) {
      case "pending":
        return "Course transport en attente";
      case "accepted":
      case "prepared":
        return "Course acceptée";
      case "ready":
        return "Prête pour retrait";
      case "dispatched":
        return "En livraison";
      case "delivered":
        return "Livrée";
      case "canceled":
        return "Annulée";
      default:
        return order.status;
    }
  }

  switch (order.status) {
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
      return order.status;
  }
}

function orderKindLabel(kind: OrderKind | null | undefined): string {
  if (kind === "pickup_dropoff") return "Pickup & dropoff";
  if (kind === "food") return "Commande restaurant";
  return "Commande";
}

function getAvatarSrc(url: string | null): string | null {
  if (!url) return null;
  const u = url.trim();
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  return null;
}

function transportModeLabel(value: string | null | undefined): string {
  if (value === "bike") return "Bike";
  if (value === "moto") return "Moto";
  if (value === "car") return "Car";
  return "—";
}

function isAvailableForDriver(order: OrderRow): boolean {
  if (order.driver_id) return false;
  if (order.status === "delivered" || order.status === "canceled") return false;

  if (order.kind === "pickup_dropoff") {
    return order.status === "pending";
  }

  if (order.kind === "food") {
    return order.status === "ready";
  }

  return false;
}

function isMineForDriver(order: OrderRow, uid: string): boolean {
  if (order.driver_id !== uid) return false;
  return order.status !== "delivered" && order.status !== "canceled";
}

export default function DriverOrdersDashboardPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [driverProfile, setDriverProfile] = useState<DriverProfile | null>(null);
  const [driverDocuments, setDriverDocuments] = useState<DriverDocumentRow[]>([]);
  const [available, setAvailable] = useState<OrderRow[]>([]);
  const [mine, setMine] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [clientByOrder, setClientByOrder] = useState<
    Record<string, ClientProfile | null>
  >({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const missingRequirements = useMemo(() => {
    if (!driverProfile) return [];

    const missing: string[] = [];
    const docTypes = new Set(driverDocuments.map((doc) => doc.doc_type));

    if (!driverProfile.full_name) missing.push("full name");
    if (!driverProfile.phone) missing.push("phone number");
    if (!driverProfile.emergency_phone) missing.push("emergency phone number");
    if (!driverProfile.address) missing.push("address");
    if (!driverProfile.city) missing.push("city");
    if (!driverProfile.state) missing.push("state");
    if (!driverProfile.zip_code) missing.push("zip code");
    if (!driverProfile.date_of_birth) missing.push("date of birth");

    if (!docTypes.has("profile_photo")) missing.push("profile photo");
    if (!docTypes.has("id_card_front")) missing.push("ID card front");
    if (!docTypes.has("id_card_back")) missing.push("ID card back");

    const requiresMotorDocs =
      driverProfile.transport_mode === "moto" || driverProfile.transport_mode === "car";

    if (requiresMotorDocs) {
      if (!driverProfile.vehicle_brand) missing.push("vehicle brand");
      if (!driverProfile.vehicle_model) missing.push("vehicle model");
      if (!driverProfile.vehicle_year) missing.push("vehicle year");
      if (!driverProfile.vehicle_color) missing.push("vehicle color");
      if (!driverProfile.plate_number) missing.push("plate number");
      if (!driverProfile.license_number) missing.push("license number");
      if (!driverProfile.license_expiry) missing.push("license expiry");
      if (!docTypes.has("license_front")) missing.push("license front");
      if (!docTypes.has("license_back")) missing.push("license back");
      if (!docTypes.has("insurance")) missing.push("insurance");
      if (!docTypes.has("registration")) missing.push("registration");
    }

    return missing;
  }, [driverProfile, driverDocuments]);

  const mustCompleteProfile =
    driverProfile?.status === "approved" && missingRequirements.length > 0;

  const isApproved = driverProfile?.status === "approved";
  const canAccessDriverWork =
    driverProfile?.status === "approved" && missingRequirements.length === 0;

  async function load() {
    setLoading(true);
    setErr(null);

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;

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
        { data: docsRow, error: docsError },
      ] = await Promise.all([
        supabase.from("profiles").select("id, full_name").eq("id", uid).maybeSingle(),
        supabase
          .from("driver_profiles")
          .select(
            `
            user_id,
            full_name,
            phone,
            emergency_phone,
            address,
            city,
            state,
            zip_code,
            date_of_birth,
            transport_mode,
            vehicle_brand,
            vehicle_model,
            vehicle_year,
            vehicle_color,
            plate_number,
            license_number,
            license_expiry,
            status,
            documents_required,
            is_online,
            missing_requirements
          `,
          )
          .eq("user_id", uid)
          .maybeSingle(),
        supabase
          .from("driver_documents")
          .select("id, user_id, doc_type, status")
          .eq("user_id", uid),
      ]);

      if (!profileError && profileRow) {
        setMe({
          id: profileRow.id,
          full_name: profileRow.full_name ?? null,
        });
      } else {
        setMe({ id: uid, full_name: user.email ?? null });
      }

      if (driverError) throw driverError;
      if (docsError) throw docsError;

      setDriverProfile((driverRow as DriverProfile | null) ?? null);
      setDriverDocuments((docsRow as DriverDocumentRow[] | null) ?? []);

      if (!driverRow) {
        setAvailable([]);
        setMine([]);
        setClientByOrder({});
        setLoading(false);
        return;
      }

      const computedMissing = (() => {
        const profile = driverRow as DriverProfile;
        const docs = (docsRow as DriverDocumentRow[] | null) ?? [];
        const docTypes = new Set(docs.map((doc) => doc.doc_type));
        const missing: string[] = [];

        if (!profile.full_name) missing.push("full name");
        if (!profile.phone) missing.push("phone number");
        if (!profile.emergency_phone) missing.push("emergency phone number");
        if (!profile.address) missing.push("address");
        if (!profile.city) missing.push("city");
        if (!profile.state) missing.push("state");
        if (!profile.zip_code) missing.push("zip code");
        if (!profile.date_of_birth) missing.push("date of birth");

        if (!docTypes.has("profile_photo")) missing.push("profile photo");
        if (!docTypes.has("id_card_front")) missing.push("ID card front");
        if (!docTypes.has("id_card_back")) missing.push("ID card back");

        const requiresMotorDocs =
          profile.transport_mode === "moto" || profile.transport_mode === "car";

        if (requiresMotorDocs) {
          if (!profile.vehicle_brand) missing.push("vehicle brand");
          if (!profile.vehicle_model) missing.push("vehicle model");
          if (!profile.vehicle_year) missing.push("vehicle year");
          if (!profile.vehicle_color) missing.push("vehicle color");
          if (!profile.plate_number) missing.push("plate number");
          if (!profile.license_number) missing.push("license number");
          if (!profile.license_expiry) missing.push("license expiry");
          if (!docTypes.has("license_front")) missing.push("license front");
          if (!docTypes.has("license_back")) missing.push("license back");
          if (!docTypes.has("insurance")) missing.push("insurance");
          if (!docTypes.has("registration")) missing.push("registration");
        }

        return missing;
      })();

      if (driverRow.status !== "approved" || computedMissing.length > 0) {
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
          kind,
          status,
          created_at,
          restaurant_name,
          currency,
          subtotal,
          total,
          distance_miles,
          eta_minutes,
          delivery_fee,
          driver_id,
          pickup_address,
          dropoff_address,
          client_user_id,
          created_by
        `,
        )
        .in("status", ACTIVE_STATUSES)
        .order("created_at", { ascending: false });

      if (ordersError) throw ordersError;

      const allOrders = (ordersData || []) as OrderRow[];

      const mineOrders = allOrders.filter((o) => isMineForDriver(o, uid));
      const availableOrders = allOrders.filter((o) => isAvailableForDriver(o));

      setMine(mineOrders);
      setAvailable(availableOrders);

      const clientIds = Array.from(
        new Set(
          allOrders
            .map((o) => o.client_user_id ?? o.created_by ?? null)
            .filter((v): v is string => typeof v === "string" && v.length > 0),
        ),
      );

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
      for (const order of allOrders) {
        const clientId = order.client_user_id ?? order.created_by ?? null;
        byOrder[order.id] = clientId ? profilesMap.get(clientId) ?? null : null;
      }

      setClientByOrder(byOrder);
    } catch (e: any) {
      console.error(e);
      setErr(e?.message ?? "Erreur lors du chargement du tableau de bord chauffeur.");
    } finally {
      setLoading(false);
    }
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
                  {missingRequirements.length > 0 ? "oui" : "non"}
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
              Courses pickup/dropoff en attente et commandes restaurant prêtes sans driver assigné.
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
                const avatarSrc = client ? getAvatarSrc(client.avatar_url) : null;

                return (
                  <article
                    key={order.id}
                    className="border rounded-xl bg-white p-4 flex flex-col gap-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">
                          {orderKindLabel(order.kind)} #{shortId}
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

                        {order.pickup_address && (
                          <p className="text-xs text-gray-600">
                            Pickup :{" "}
                            <span className="font-medium">{order.pickup_address}</span>
                          </p>
                        )}

                        {order.dropoff_address && (
                          <p className="text-xs text-gray-600">
                            Dropoff :{" "}
                            <span className="font-medium">{order.dropoff_address}</span>
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
                                {(client.full_name || "C").charAt(0).toUpperCase()}
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
                        {driverStatusLabel(order)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-700">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                        <p>
                          <span className="text-gray-500 mr-1">Distance :</span>
                          <span className="font-medium">{formatDistance(order)}</span>
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
                const avatarSrc = client ? getAvatarSrc(client.avatar_url) : null;

                return (
                  <article
                    key={order.id}
                    className="border rounded-xl bg-white p-4 flex flex-col gap-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">
                          {orderKindLabel(order.kind)} #{shortId}
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

                        {order.pickup_address && (
                          <p className="text-xs text-gray-600">
                            Pickup :{" "}
                            <span className="font-medium">{order.pickup_address}</span>
                          </p>
                        )}

                        {order.dropoff_address && (
                          <p className="text-xs text-gray-600">
                            Dropoff :{" "}
                            <span className="font-medium">{order.dropoff_address}</span>
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
                                {(client.full_name || "C").charAt(0).toUpperCase()}
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
                        {driverStatusLabel(order)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-gray-700">
                      <p>
                        <span className="text-gray-500 mr-1">Distance :</span>
                        <span className="font-medium">{formatDistance(order)}</span>
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