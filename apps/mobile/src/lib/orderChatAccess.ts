export type ChatSourceTable =
  | "orders"
  | "delivery_requests"
  | "taxi_rides"
  | "marketplace_delivery_jobs";

export type ChatTargetRole = "client" | "driver" | "restaurant" | "admin" | "";

export type ChatParticipantIds = {
  clientId: string;
  driverId: string;
  restaurantUserId: string;
  restaurantLabel: string;
  blocked: boolean;
};

export function normalizeChatSourceTable(value: unknown): ChatSourceTable {
  const raw = String(value ?? "orders").trim().toLowerCase();

  if (raw === "delivery_requests" || raw === "delivery_request") {
    return "delivery_requests";
  }
  if (raw === "taxi_rides" || raw === "taxi_ride") {
    return "taxi_rides";
  }
  if (
    raw === "marketplace_delivery_jobs" ||
    raw === "marketplace_delivery_job"
  ) {
    return "marketplace_delivery_jobs";
  }
  return "orders";
}

function isTerminalStatus(sourceTable: ChatSourceTable, status: string): boolean {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (!normalized) return false;

  if (sourceTable === "orders") {
    return normalized === "canceled" || normalized === "cancelled" || normalized === "delivered";
  }
  if (sourceTable === "delivery_requests") {
    return normalized === "cancelled" || normalized === "canceled" || normalized === "delivered";
  }
  if (sourceTable === "taxi_rides") {
    return normalized === "cancelled" || normalized === "canceled" || normalized === "completed";
  }
  if (sourceTable === "marketplace_delivery_jobs") {
    return normalized === "cancelled" || normalized === "canceled" || normalized === "delivered";
  }
  return false;
}

export async function loadChatParticipantIds(
  supabase: {
    from: (table: string) => any;
  },
  orderId: string,
  sourceTable: ChatSourceTable,
): Promise<ChatParticipantIds | null> {
  if (sourceTable === "delivery_requests") {
    const { data, error } = await supabase
      .from("delivery_requests")
      .select("id,status,client_user_id,created_by,user_id,driver_id")
      .eq("id", orderId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return {
      clientId:
        String(data.client_user_id || data.created_by || data.user_id || "").trim(),
      driverId: String(data.driver_id || "").trim(),
      restaurantUserId: "",
      restaurantLabel: "",
      blocked: isTerminalStatus(sourceTable, data.status),
    };
  }

  if (sourceTable === "taxi_rides") {
    const { data, error } = await supabase
      .from("taxi_rides")
      .select("id,status,client_user_id,driver_id")
      .eq("id", orderId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return {
      clientId: String(data.client_user_id || "").trim(),
      driverId: String(data.driver_id || "").trim(),
      restaurantUserId: "",
      restaurantLabel: "",
      blocked: isTerminalStatus(sourceTable, data.status),
    };
  }

  if (sourceTable === "marketplace_delivery_jobs") {
    const { data, error } = await supabase
      .from("marketplace_delivery_jobs")
      .select("id,status,client_id,assigned_driver_id,seller_id,sellers(user_id,business_name)")
      .eq("id", orderId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    const seller = (data as any).sellers as
      | { user_id?: string | null; business_name?: string | null }
      | null;

    return {
      clientId: String(data.client_id || "").trim(),
      driverId: String(data.assigned_driver_id || "").trim(),
      restaurantUserId: String(seller?.user_id || "").trim(),
      restaurantLabel: String(seller?.business_name || "Seller").trim(),
      blocked: isTerminalStatus(sourceTable, data.status),
    };
  }

  const { data, error } = await supabase
    .from("orders")
    .select(
      "id,status,client_id,client_user_id,user_id,restaurant_id,restaurant_user_id,driver_id,restaurant_name",
    )
    .eq("id", orderId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    clientId:
      String(data.client_user_id || data.client_id || data.user_id || "").trim(),
    driverId: String(data.driver_id || "").trim(),
    restaurantUserId:
      String(data.restaurant_user_id || data.restaurant_id || "").trim(),
    restaurantLabel: String(data.restaurant_name || "").trim(),
    blocked: isTerminalStatus(sourceTable, data.status),
  };
}

export function canRoleAccessChatResource(params: {
  userId: string;
  role: ChatTargetRole;
  participantIds: ChatParticipantIds;
}): boolean {
  const { userId, role, participantIds } = params;
  if (!userId) return false;
  if (participantIds.blocked) return false;

  const isClient = participantIds.clientId === userId;
  const isDriver = participantIds.driverId === userId;
  const isRestaurant = participantIds.restaurantUserId === userId;
  const isAdmin = role === "admin";

  return (
    isAdmin ||
    (role === "client" && isClient) ||
    (role === "driver" && isDriver) ||
    (role === "restaurant" && isRestaurant)
  );
}

export function resolveChatTargetUserId(
  participantIds: ChatParticipantIds,
  targetRole: ChatTargetRole,
): string | null {
  if (targetRole === "client") return participantIds.clientId || null;
  if (targetRole === "driver") return participantIds.driverId || null;
  if (targetRole === "restaurant") return participantIds.restaurantUserId || null;
  return null;
}

export function mapTargetRoleToPushRole(
  targetRole: ChatTargetRole,
): "client" | "driver" | "restaurant" | null {
  if (targetRole === "client") return "client";
  if (targetRole === "driver") return "driver";
  if (targetRole === "restaurant") return "restaurant";
  return null;
}
