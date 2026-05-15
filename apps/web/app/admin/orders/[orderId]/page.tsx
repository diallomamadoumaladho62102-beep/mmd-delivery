"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import { OrderTimeline } from "@/components/orders/OrderTimeline";
import { canAccessAdminDashboard } from "@/lib/adminAccess";
import AdminCancelRefundPanel from "@/components/AdminCancelRefundPanel";

type OrderStatus =
  | "pending"
  | "accepted"
  | "prepared"
  | "ready"
  | "dispatched"
  | "delivered"
  | "canceled";

type OrderItem = {
  name: string;
  category?: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
};

type AdminCommunicationTarget = "client" | "driver" | "restaurant";

type OrderRow = {
  id: string;
  status: OrderStatus;
  kind: string | null;
  user_id: string | null;
  client_id: string | null;
  client_user_id: string | null;
  driver_id: string | null;
  restaurant_id: string | null;
  restaurant_name: string | null;
  created_at: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  currency: string | null;
  distance_miles: number | null;
  eta_minutes: number | null;
  delivery_fee: number | null;
  driver_delivery_payout: number | null;
  platform_delivery_fee: number | null;
  restaurant_commission_rate: number | null;
  restaurant_commission_amount: number | null;
  restaurant_net_amount: number | null;
  items_json: OrderItem[] | null;
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";

  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";

    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
  } catch {
    return "—";
  }
}

function formatMoney(
  value: number | null | undefined,
  currency = "USD"
): string {
  if (value == null) return "—";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(value);
}

function statusLabel(status: OrderStatus): string {
  switch (status) {
    case "pending":
      return "En attente";
    case "accepted":
      return "Acceptée par le restaurant";
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
      return status;
  }
}

function statusBadgeClass(status: OrderStatus): string {
  switch (status) {
    case "delivered":
      return "border-green-200 bg-green-100 text-green-800";
    case "canceled":
      return "border-red-200 bg-red-100 text-red-800";
    case "dispatched":
      return "border-blue-200 bg-blue-100 text-blue-800";
    case "ready":
      return "border-amber-200 bg-amber-100 text-amber-800";
    case "accepted":
    case "prepared":
      return "border-violet-200 bg-violet-100 text-violet-800";
    case "pending":
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {subtitle ? (
          <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 py-1.5 sm:grid-cols-[220px_minmax(0,1fr)]">
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className="text-sm text-slate-900">{value}</div>
    </div>
  );
}

export default function AdminOrderPage() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const orderId = typeof params?.orderId === "string" ? params.orderId : "";

  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [order, setOrder] = useState<OrderRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [callingTarget, setCallingTarget] = useState<AdminCommunicationTarget | null>(null);

  const loadPage = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (!orderId) return;

      try {
        if (mode === "initial") {
          setLoading(true);
        } else {
          setRefreshing(true);
        }

        setErr(null);

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError) {
          throw new Error(userError.message);
        }

        if (!user) {
          setIsAdmin(false);
          setAuthChecked(true);
          router.push("/auth/login");
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("id, role")
          .eq("id", user.id)
          .maybeSingle();

        if (profileError) {
          throw new Error(profileError.message);
        }

        if (!profile || !canAccessAdminDashboard(profile.role)) {
          setIsAdmin(false);
          setAuthChecked(true);
          setErr("Access restricted to administrators.");
          return;
        }

        setIsAdmin(true);
        setAuthChecked(true);

        const { data, error } = await supabase
          .from("orders")
          .select(
            `
              id,
              status,
              kind,
              user_id,
              client_id,
              client_user_id,
              driver_id,
              restaurant_id,
              restaurant_name,
              created_at,
              subtotal,
              tax,
              total,
              currency,
              distance_miles,
              eta_minutes,
              delivery_fee,
              driver_delivery_payout,
              platform_delivery_fee,
              restaurant_commission_rate,
              restaurant_commission_amount,
              restaurant_net_amount,
              items_json
            `
          )
          .eq("id", orderId)
          .maybeSingle();

        if (error) {
          throw new Error(
            error.message || "Erreur lors du chargement de la commande."
          );
        }

        if (!data) {
          throw new Error("Commande introuvable.");
        }

        setOrder(data as OrderRow);
      } catch (error) {
        setErr(error instanceof Error ? error.message : "Unknown error");
        setOrder(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [orderId, router]
  );

  useEffect(() => {
    if (!orderId) return;
    void loadPage("initial");
  }, [orderId, loadPage]);

  const currency = order?.currency || "USD";
  const shortId = order?.id.slice(0, 8) || "—";

  const distanceLabel = useMemo(() => {
    if (order?.distance_miles == null) return "—";
    return `${order.distance_miles.toFixed(2)} mi`;
  }, [order?.distance_miles]);

  const etaLabel = useMemo(() => {
    if (order?.eta_minutes == null) return "—";
    return `${Math.round(order.eta_minutes)} min`;
  }, [order?.eta_minutes]);

  const restaurantCommission = order?.restaurant_commission_amount ?? 0;
  const deliveryPlatformFee = order?.platform_delivery_fee ?? 0;
  const mmdTotalCommission = restaurantCommission + deliveryPlatformFee;
  const driverPayout = order?.driver_delivery_payout ?? 0;
  const mmdGrossMargin = mmdTotalCommission - driverPayout;

  const effectiveClientId =
    order?.client_id ?? order?.client_user_id ?? order?.user_id ?? null;

  const isFinalOrder = order?.status === "delivered" || order?.status === "canceled";

  const communicationDisabled = refreshing || callingTarget !== null || isFinalOrder;

  const getMissingTargetMessage = useCallback(
    (targetRole: AdminCommunicationTarget) => {
      if (targetRole === "client" && !effectiveClientId) {
        return "Client introuvable pour cette commande.";
      }

      if (targetRole === "driver" && !order?.driver_id) {
        return "Aucun chauffeur n’est encore assigné à cette commande.";
      }

      if (targetRole === "restaurant" && !order?.restaurant_id) {
        return "Restaurant introuvable pour cette commande.";
      }

      return null;
    },
    [effectiveClientId, order?.driver_id, order?.restaurant_id]
  );

  const startAdminCall = useCallback(
    async (targetRole: AdminCommunicationTarget) => {
      if (!order?.id || callingTarget) return;

      if (isFinalOrder) {
        alert("Les appels sont désactivés pour une commande terminée ou annulée.");
        return;
      }

      const missing = getMissingTargetMessage(targetRole);
      if (missing) {
        alert(missing);
        return;
      }

      try {
        setCallingTarget(targetRole);

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) {
          throw new Error(sessionError.message);
        }

        if (!session?.access_token) {
          throw new Error("Session admin expirée. Reconnecte-toi puis réessaie.");
        }

        const response = await fetch("/api/twilio/calls/create", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            orderId: order.id,
            callerRole: "admin",
            targetRole,
          }),
        });

        const json = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(json?.error || "Unable to create call session");
        }

        const proxyNumber = String(json?.proxyNumber || "").trim();

        if (!proxyNumber) {
          throw new Error("Numéro proxy manquant.");
        }

        window.location.href = `tel:${proxyNumber}`;
      } catch (error) {
        alert(error instanceof Error ? error.message : "Erreur appel admin.");
      } finally {
        setCallingTarget(null);
      }
    },
    [callingTarget, getMissingTargetMessage, isFinalOrder, order?.id]
  );

  const openAdminChat = useCallback(
    (targetRole: AdminCommunicationTarget) => {
      if (!order?.id) return;

      if (isFinalOrder) {
        alert("Les messages sont désactivés pour une commande terminée ou annulée.");
        return;
      }

      const missing = getMissingTargetMessage(targetRole);
      if (missing) {
        alert(missing);
        return;
      }

      router.push(`/admin/orders/${order.id}/chat?targetRole=${targetRole}`);
    },
    [getMissingTargetMessage, isFinalOrder, order?.id, router]
  );

  if (loading || !authChecked) {
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-5xl px-4 py-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <p className="text-sm text-slate-600">Chargement de la commande…</p>
          </div>
        </div>
      </main>
    );
  }

  if (err || !order || !isAdmin) {
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
          <button
            type="button"
            onClick={() => router.push("/admin/orders")}
            className="text-xs text-blue-600 underline"
          >
            ← Retour aux commandes (admin)
          </button>

          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 shadow-sm">
            <p className="text-sm text-red-700">
              {err ?? "Commande introuvable."}
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => router.push("/admin/orders")}
            className="text-xs text-blue-600 underline"
          >
            ← Retour aux commandes (admin)
          </button>

          <button
            type="button"
            onClick={() => void loadPage("refresh")}
            disabled={refreshing}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-900 bg-slate-900 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <header className="space-y-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
            MMD Delivery · Admin Order Detail
          </div>

          <h1 className="text-2xl font-bold text-slate-900">
            Commande #{shortId} (vue admin)
          </h1>

          <p className="text-sm text-slate-600">
            Détail complet de la commande pour l&apos;administration MMD
            Delivery.
          </p>

          <div className="pt-1">
            <span
              className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${statusBadgeClass(
                order.status
              )}`}
            >
              Statut : {statusLabel(order.status)}
            </span>
          </div>

          <p className="text-xs text-slate-500">
            Créée le : {formatDate(order.created_at)}
          </p>
        </header>

        <AdminCancelRefundPanel
          defaultOrderId={order.id}
          defaultReason="admin_cancel_refund_from_order_detail"
          onCompleted={() => void loadPage("refresh")}
        />

        <SectionCard title="Informations générales">
          <InfoRow label="Type" value={order.kind || "—"} />
          <InfoRow label="Client (client_id)" value={effectiveClientId || "—"} />
          <InfoRow label="Ancien user_id" value={order.user_id || "—"} />
          <InfoRow label="Chauffeur (driver_id)" value={order.driver_id || "—"} />
          <InfoRow
            label="Restaurant (restaurant_id)"
            value={order.restaurant_id || "—"}
          />
          <InfoRow
            label="Nom du restaurant"
            value={order.restaurant_name || "—"}
          />
        </SectionCard>

        <SectionCard
          title="Communication admin"
          subtitle="Appeler ou ouvrir une discussion ciblée avec le client, le chauffeur ou le restaurant."
        >
          <div className="grid gap-3 md:grid-cols-3">
            {([
              ["client", "Client", effectiveClientId],
              ["driver", "Chauffeur", order.driver_id],
              ["restaurant", "Restaurant", order.restaurant_id],
            ] as const).map(([targetRole, label, targetId]) => {
              const disabled = communicationDisabled || !targetId;
              const isCalling = callingTarget === targetRole;

              return (
                <div
                  key={targetRole}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="mb-3">
                    <p className="text-sm font-semibold text-slate-900">{label}</p>
                    <p className="mt-1 break-all text-[11px] text-slate-500">
                      {targetId || "Non disponible"}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => void startAdminCall(targetRole)}
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-900 bg-slate-900 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isCalling ? "Appel..." : "Call"}
                    </button>

                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => openAdminChat(targetRole)}
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Message
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {isFinalOrder ? (
            <p className="mt-3 text-[11px] text-slate-500">
              Communication désactivée parce que cette commande est terminée ou annulée.
            </p>
          ) : null}
        </SectionCard>

        <SectionCard title="Récapitulatif de la commande (plats)">
          {order.items_json && order.items_json.length > 0 ? (
            <div className="space-y-2">
              {order.items_json.map((item, idx) => (
                <div
                  key={`${item.name}-${idx}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3"
                >
                  <div>
                    <p className="font-medium text-slate-900">{item.name}</p>
                    {item.category ? (
                      <p className="text-[11px] text-slate-500">
                        {item.category}
                      </p>
                    ) : null}
                    <p className="text-[11px] text-slate-500">
                      Qté {item.quantity} —{" "}
                      {formatMoney(item.unit_price, currency)} / unité
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-slate-900">
                    {formatMoney(item.line_total, currency)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              Aucun détail de plats enregistré.
            </p>
          )}

          <div className="mt-3 space-y-1 border-t border-slate-200 pt-3">
            <InfoRow
              label="Montant (plats)"
              value={formatMoney(order.subtotal, currency)}
            />
            <InfoRow label="Taxes" value={formatMoney(order.tax, currency)} />
            <InfoRow
              label="Total client"
              value={formatMoney(order.total, currency)}
            />
          </div>
        </SectionCard>

        <SectionCard title="Livraison (distance / temps / frais)">
          <InfoRow label="Distance estimée" value={distanceLabel} />
          <InfoRow label="Temps estimé" value={etaLabel} />
          <InfoRow
            label="Frais de livraison facturés"
            value={formatMoney(order.delivery_fee, currency)}
          />
        </SectionCard>

        <SectionCard
          title="Commission restaurant (plats)"
          subtitle="Calcul basé sur le taux configuré sur la commande"
        >
          <InfoRow
            label="Taux MMD (sur plats)"
            value={
              order.restaurant_commission_rate != null
                ? `${(order.restaurant_commission_rate * 100).toFixed(2)} %`
                : "—"
            }
          />
          <InfoRow
            label="Commission MMD"
            value={formatMoney(order.restaurant_commission_amount, currency)}
          />
          <InfoRow
            label="Montant net restaurant"
            value={formatMoney(order.restaurant_net_amount, currency)}
          />

          <p className="mt-3 text-[11px] text-slate-500">
            Calcul basé sur 15% MMD / 85% restaurant sur le montant des plats
            (ou le taux configuré si différent).
          </p>
        </SectionCard>

        <SectionCard
          title="Commission MMD & rémunération chauffeur"
          subtitle="Répartition sur les frais de livraison"
        >
          <InfoRow
            label="Frais de livraison (client)"
            value={formatMoney(order.delivery_fee, currency)}
          />
          <InfoRow
            label="Part chauffeur"
            value={formatMoney(order.driver_delivery_payout, currency)}
          />
          <InfoRow
            label="Part MMD (plateforme)"
            value={formatMoney(order.platform_delivery_fee, currency)}
          />

          <p className="mt-3 text-[11px] text-slate-500">
            Basé sur la répartition actuelle : 80% chauffeur / 20% plateforme
            sur les frais de livraison. Ces règles pourront être ajustées dans
            le panneau admin MMD Delivery.
          </p>
        </SectionCard>

        <SectionCard
          title="Résumé financier MMD (par commande)"
          subtitle="Vue simplifiée de la marge brute"
        >
          <InfoRow
            label="Commission MMD sur plats"
            value={formatMoney(restaurantCommission, currency)}
          />
          <InfoRow
            label="Commission MMD sur livraison"
            value={formatMoney(deliveryPlatformFee, currency)}
          />
          <InfoRow
            label="Commission totale MMD (plats + livraison)"
            value={formatMoney(mmdTotalCommission, currency)}
          />
          <InfoRow
            label="Rémunération chauffeur"
            value={formatMoney(driverPayout, currency)}
          />
          <InfoRow
            label="Marge brute MMD (approx.)"
            value={formatMoney(mmdGrossMargin, currency)}
          />

          <p className="mt-3 text-[11px] text-slate-500">
            Marge brute MMD ≈ (commission sur plats + commission sur livraison)
            - rémunération chauffeur. Les frais de carte, taxes, marketing, etc.
            viendront encore réduire cette marge.
          </p>
        </SectionCard>

        <SectionCard title="Timeline de commande">
          <OrderTimeline orderId={order.id} />
        </SectionCard>

        <div className="pt-1">
          <Link
            href={`/admin/payouts/${order.id}`}
            className="text-sm font-medium text-blue-600 underline underline-offset-2 hover:text-blue-800"
          >
            Ouvrir aussi la vue payout de cette commande
          </Link>
        </div>
      </div>
    </main>
  );
}