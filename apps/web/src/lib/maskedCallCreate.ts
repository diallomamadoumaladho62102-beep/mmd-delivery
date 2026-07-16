export type CallRole = "client" | "driver" | "restaurant" | "admin";

export type SourceTable =
  | "orders"
  | "delivery_requests"
  | "taxi_rides"
  | "marketplace_delivery_jobs";

export type CallResourceContext = {
  sourceTable: SourceTable;
  resourceId: string;
  resourceLabel: string;
};

export type OrderLikeRow = {
  id: string;
  client_id?: string | null;
  client_user_id?: string | null;
  created_by?: string | null;
  user_id?: string | null;
  driver_id?: string | null;
  driver_user_id?: string | null;
  restaurant_id?: string | null;
  assigned_driver_id?: string | null;
  seller_id?: string | null;
  seller_user_id?: string | null;
};

const SOURCE_TABLES: SourceTable[] = [
  "orders",
  "delivery_requests",
  "taxi_rides",
  "marketplace_delivery_jobs",
];

const ALLOWED_ROLES: CallRole[] = ["client", "driver", "restaurant", "admin"];

export function normalizeSourceTable(value: unknown): SourceTable {
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

export function isAllowedCallRole(value: unknown): value is CallRole {
  return typeof value === "string" && ALLOWED_ROLES.includes(value as CallRole);
}

export function getResourceLabel(sourceTable: SourceTable): string {
  if (sourceTable === "delivery_requests") return "Delivery request";
  if (sourceTable === "taxi_rides") return "Taxi ride";
  if (sourceTable === "marketplace_delivery_jobs") return "Marketplace delivery";
  return "Order";
}

export function getUserIdByRole(
  row: OrderLikeRow,
  role: CallRole,
  sourceTable: SourceTable,
): string | null {
  if (role === "admin") return null;

  if (sourceTable === "taxi_rides") {
    if (role === "client") {
      return row.client_user_id ?? row.client_id ?? row.user_id ?? null;
    }
    if (role === "driver") {
      return row.driver_id ?? row.driver_user_id ?? null;
    }
    return null;
  }

  if (sourceTable === "marketplace_delivery_jobs") {
    if (role === "client") {
      return row.client_id ?? row.client_user_id ?? null;
    }
    if (role === "driver") {
      return row.assigned_driver_id ?? row.driver_id ?? row.driver_user_id ?? null;
    }
    if (role === "restaurant") {
      return row.seller_user_id ?? null;
    }
    return null;
  }

  if (sourceTable === "delivery_requests") {
    if (role === "client") {
      return (
        row.client_user_id ??
        row.client_id ??
        row.created_by ??
        row.user_id ??
        null
      );
    }
    if (role === "driver") {
      return row.driver_id ?? row.driver_user_id ?? null;
    }
    return null;
  }

  if (role === "client") {
    return row.client_id ?? row.client_user_id ?? row.created_by ?? null;
  }
  if (role === "driver") {
    return row.driver_id ?? row.driver_user_id ?? null;
  }
  if (role === "restaurant") {
    return row.restaurant_id ?? null;
  }

  return null;
}

export function isRoleSupportedForSource(
  role: CallRole,
  sourceTable: SourceTable,
): boolean {
  if (role === "admin") return true;
  if (sourceTable === "orders") return true;
  if (sourceTable === "delivery_requests") {
    return role === "client" || role === "driver";
  }
  if (sourceTable === "taxi_rides") {
    return role === "client" || role === "driver";
  }
  if (sourceTable === "marketplace_delivery_jobs") {
    return role === "client" || role === "driver" || role === "restaurant";
  }
  return false;
}

export function buildParticipantRpc(
  sourceTable: SourceTable,
  resourceId: string,
): { fn: string; args: Record<string, string> } {
  if (sourceTable === "delivery_requests") {
    return {
      fn: "delivery_request_participant_ids",
      args: { p_request_id: resourceId },
    };
  }
  if (sourceTable === "taxi_rides") {
    return {
      fn: "taxi_ride_participant_ids",
      args: { p_ride_id: resourceId },
    };
  }
  if (sourceTable === "marketplace_delivery_jobs") {
    return {
      fn: "marketplace_delivery_job_participant_ids",
      args: { p_job_id: resourceId },
    };
  }
  return {
    fn: "order_participant_ids",
    args: { p_order_id: resourceId },
  };
}

export function parseCreateMaskedCallBody(body: unknown): {
  resourceId: string;
  callerRole: CallRole;
  targetRole: CallRole;
  sourceTable: SourceTable;
} | { error: string; status: number } {
  const raw = (body ?? {}) as Record<string, unknown>;
  const resourceId = String(raw.orderId ?? raw.order_id ?? "").trim();
  const callerRole = raw.callerRole ?? raw.caller_role;
  const targetRole = raw.targetRole ?? raw.target_role;
  const sourceTable = normalizeSourceTable(raw.sourceTable ?? raw.source_table);

  if (!resourceId || !callerRole || !targetRole) {
    return { error: "Missing required fields", status: 400 };
  }

  if (!isAllowedCallRole(callerRole) || !isAllowedCallRole(targetRole)) {
    return { error: "Invalid role", status: 400 };
  }

  if (callerRole === targetRole) {
    return {
      error: "Caller and target roles cannot be the same",
      status: 400,
    };
  }

  if (!SOURCE_TABLES.includes(sourceTable)) {
    return { error: "Invalid source table", status: 400 };
  }

  if (!isRoleSupportedForSource(callerRole, sourceTable)) {
    return {
      error: `${getResourceLabel(sourceTable)} does not support caller role ${callerRole}`,
      status: 400,
    };
  }

  if (!isRoleSupportedForSource(targetRole, sourceTable)) {
    return {
      error: `${getResourceLabel(sourceTable)} does not support target role ${targetRole}`,
      status: 400,
    };
  }

  return {
    resourceId,
    callerRole,
    targetRole,
    sourceTable,
  };
}
