import { API_BASE_URL } from "./apiBase";
import { supabase } from "./supabase";
import { logTechnicalError, toUserFacingError } from "./userFacingError";

export type NotificationInboxItem = {
  id: string;
  title: string | null;
  body: string | null;
  data: Record<string, unknown> | null;
  status: string | null;
  role: string | null;
  sent_at: string | null;
  created_at: string;
  read_at: string | null;
  archived_at: string | null;
};

export type NotificationInboxResponse = {
  ok: boolean;
  items: NotificationInboxItem[];
  unread_count: number;
};

async function getAuthHeaders() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const token = data.session?.access_token;
  if (!token) {
    throw new Error("Session expired. Please sign in again.");
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function baseUrl() {
  return String(API_BASE_URL).replace(/\/$/, "");
}

export async function fetchNotificationInbox(params?: {
  limit?: number;
  includeArchived?: boolean;
}): Promise<NotificationInboxResponse> {
  const qs = new URLSearchParams();
  if (params?.limit != null) qs.set("limit", String(params.limit));
  if (params?.includeArchived) qs.set("include_archived", "1");
  const q = qs.toString();
  const path = `/api/notifications/inbox${q ? `?${q}` : ""}`;

  const res = await fetch(`${baseUrl()}${path}`, {
    method: "GET",
    headers: await getAuthHeaders(),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok) {
    logTechnicalError("notifications.inbox.get", out, { status: res.status });
    throw new Error(
      toUserFacingError(
        out,
        "Unable to load notifications. Please try again."
      )
    );
  }
  return {
    ok: Boolean(out?.ok),
    items: Array.isArray(out?.items) ? out.items : [],
    unread_count: Number(out?.unread_count ?? 0),
  };
}

export async function patchNotificationInbox(
  id: string,
  action: "read" | "unread" | "archive" | "unarchive"
) {
  const res = await fetch(`${baseUrl()}/api/notifications/inbox`, {
    method: "PATCH",
    headers: await getAuthHeaders(),
    body: JSON.stringify({ id, action }),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok) {
    logTechnicalError("notifications.inbox.patch", out, {
      status: res.status,
      action,
    });
    throw new Error(
      toUserFacingError(out, "Unable to update notification. Please try again.")
    );
  }
  return out;
}

export function notificationDeepLinkTarget(
  data: Record<string, unknown> | null | undefined
):
  | { screen: "ClientOrderDetails"; params: { orderId: string } }
  | { screen: "TaxiRideTracking"; params: { rideId: string } }
  | {
      screen: "ClientDeliveryRequestDetails";
      params: { requestId: string };
    }
  | null {
  if (!data || typeof data !== "object") return null;

  const orderId = String(
    data.order_id ?? data.orderId ?? ""
  ).trim();
  if (orderId) {
    return { screen: "ClientOrderDetails", params: { orderId } };
  }

  const rideId = String(
    data.taxi_ride_id ?? data.taxiRideId ?? data.ride_id ?? data.rideId ?? ""
  ).trim();
  if (rideId) {
    return { screen: "TaxiRideTracking", params: { rideId } };
  }

  const requestId = String(
    data.delivery_request_id ??
      data.deliveryRequestId ??
      data.request_id ??
      data.requestId ??
      ""
  ).trim();
  if (requestId) {
    return {
      screen: "ClientDeliveryRequestDetails",
      params: { requestId },
    };
  }

  return null;
}
