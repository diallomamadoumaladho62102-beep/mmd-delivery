const STATUS_LABELS: Record<string, string> = {
  pending: "Order received — waiting for confirmation",
  accepted: "Accepted by the restaurant or platform",
  prepared: "Being prepared",
  ready: "Ready for pickup by driver",
  dispatched: "Driver assigned or on the way",
  delivered: "Delivered",
  canceled: "Canceled",
  cancelled: "Canceled",
  on_the_way: "On the way",
  picked_up: "Picked up",
  requested: "Taxi requested — looking for a driver",
  searching: "Searching for a nearby driver",
  assigned: "Driver assigned",
  driver_assigned: "Driver assigned",
  arriving: "Driver is arriving",
  driver_arrived: "Driver has arrived",
  in_progress: "Trip in progress",
  completed: "Completed",
  unpaid: "Waiting for payment",
};

export function explainOrderStatus(status: unknown): string {
  const key = String(status ?? "")
    .trim()
    .toLowerCase();
  return STATUS_LABELS[key] ?? `Current status: ${key || "unknown"}`;
}
