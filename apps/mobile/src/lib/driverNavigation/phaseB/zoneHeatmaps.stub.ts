import { DRIVER_NAV_PHASE_B } from "../phaseB.config";
import type { CoordinatePoint } from "../../coordinates";

export type DemandZoneHeat = {
  id: string;
  name: string;
  center: CoordinatePoint;
  intensity: number;
  polygon: CoordinatePoint[];
};

/**
 * Phase B — demand heatmaps overlay on driver map.
 * Not activated.
 */
export async function fetchDemandZoneHeatmaps(
  _center: CoordinatePoint,
): Promise<DemandZoneHeat[]> {
  if (!DRIVER_NAV_PHASE_B.zoneHeatmaps.enabled) return [];
  return [];
}
