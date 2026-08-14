import i18n from "i18next";
import { API_BASE_URL } from "./apiBase";
import { supabase } from "./supabase";
import { toUserFacingError } from "./userFacingError";

export type RestaurantStatusUpdate = "accepted" | "prepared" | "ready";

export async function postRestaurantOrderStatus(params: {
  orderId: string;
  status: RestaurantStatusUpdate;
}) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

  if (sessionError) {
    throw sessionError;
  }

  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error("Session expirée. Reconnecte-toi puis réessaie.");
  }

  const base = String(API_BASE_URL).replace(/\/$/, "");
  const res = await fetch(`${base}/api/orders/restaurant/status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      orderId: params.orderId,
      status: params.status,
    }),
  });

  const out = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(
      toUserFacingError(
        out,
        i18n.t("restaurant.orders.statusUpdateFailed", {
          status: res.status,
          defaultValue: "Unable to update the order status ({{status}}).",
        }),
      ),
    );
  }

  return out as {
    ok?: boolean;
    orderId?: string;
    status?: string;
    smartDispatch?: { ok?: boolean; status?: number };
  };
}

export async function postRestaurantOrderReject(params: { orderId: string }) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

  if (sessionError) {
    throw sessionError;
  }

  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error("Session expirée. Reconnecte-toi puis réessaie.");
  }

  const base = String(API_BASE_URL).replace(/\/$/, "");
  const res = await fetch(`${base}/api/orders/cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      orderId: params.orderId,
      role: "restaurant",
    }),
  });

  const out = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(
      toUserFacingError(
        out,
        i18n.t("restaurant.orders.rejectFailed", {
          status: res.status,
          defaultValue: "Unable to refuse the order ({{status}}).",
        }),
      ),
    );
  }

  return out as {
    ok?: boolean;
    cancelled?: boolean;
    refund?: string;
    stripeRefund?: { refunded?: boolean; refundId?: string | null };
    message?: string;
  };
}
