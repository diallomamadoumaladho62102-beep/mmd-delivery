import { mmdAudio } from "./mmdAudio";
import { isDriverMissionPushType } from "./driverMissionPush";

/**
 * Global driver mission long-ring — independent of DriverHomeScreen / isFocused.
 * Starts on delivery_request_dispatch / driver_offer / taxi_offer_dispatch push.
 * Stop only via explicit stopDriverMissionAlert (accept / decline / expire).
 */

let ringing = false;
let activeKey: string | null = null;

function missionKey(type: string, id: string | null): string {
  return `${type}:${id ?? "unknown"}`;
}

export async function startDriverMissionAlert(params: {
  type: string;
  orderId?: string | null;
  deliveryRequestId?: string | null;
  taxiRideId?: string | null;
}): Promise<void> {
  if (!isDriverMissionPushType(params.type)) return;

  const id =
    params.deliveryRequestId ?? params.orderId ?? params.taxiRideId ?? null;
  const key = missionKey(params.type, id);

  if (ringing && activeKey === key) return;

  ringing = true;
  activeKey = key;
  try {
    await mmdAudio.startLongRing("driver");
  } catch (error) {
    console.log("[driverMissionAlert] startLongRing failed", error);
    ringing = false;
    activeKey = null;
  }
}

export async function stopDriverMissionAlert(): Promise<void> {
  if (!ringing && !activeKey) {
    try {
      await mmdAudio.stopLongRing();
    } catch {
      /* ignore */
    }
    return;
  }
  ringing = false;
  activeKey = null;
  try {
    await mmdAudio.stopLongRing();
  } catch {
    /* ignore */
  }
}

export function handleDriverMissionPushAlert(data: unknown): void {
  const record = (data ?? {}) as Record<string, unknown>;
  const type = String(record.type ?? "").trim();
  if (!isDriverMissionPushType(type)) return;

  void startDriverMissionAlert({
    type,
    orderId: String(record.orderId ?? record.order_id ?? "").trim() || null,
    deliveryRequestId:
      String(record.deliveryRequestId ?? record.delivery_request_id ?? "").trim() ||
      null,
    taxiRideId:
      String(record.taxiRideId ?? record.taxi_ride_id ?? "").trim() || null,
  });
}

export function isDriverMissionAlertRinging(): boolean {
  return ringing;
}
