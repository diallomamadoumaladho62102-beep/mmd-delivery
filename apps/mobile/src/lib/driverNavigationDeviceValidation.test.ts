/**
 * Validation cadrage véhicule — dimensions Android & iOS (sans simulateur iOS sur CI/Windows).
 */
import {
  computeNavigationBottomStack,
  computeNavigationScreenLayout,
  NAV_ICON_SCREEN_RATIO,
  TOAST_CLUSTER_GAP_RATIO,
  CLUSTER_VEHICLE_GAP_RATIO,
  TRIP_BAR_HEIGHT_RATIO,
  TOAST_ABOVE_TRIP_RATIO,
} from "./driverNavigationVisual";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

type DeviceSpec = {
  platform: "android" | "ios";
  name: string;
  width: number;
  height: number;
};

const DEVICES: DeviceSpec[] = [
  { platform: "android", name: "Pixel 5", width: 1080, height: 2340 },
  { platform: "android", name: "Pixel 7", width: 1080, height: 2400 },
  { platform: "android", name: "Pixel 8 Pro", width: 1344, height: 2992 },
  { platform: "android", name: "Small Android", width: 720, height: 1280 },
  { platform: "ios", name: "iPhone SE", width: 375, height: 667 },
  { platform: "ios", name: "iPhone 15", width: 393, height: 852 },
  { platform: "ios", name: "iPhone 15 Pro Max", width: 430, height: 932 },
];

function anchorCenterY(
  height: number,
  paddingTop: number,
  paddingBottom: number,
): number {
  return paddingTop + (height - paddingTop - paddingBottom) / 2;
}

function clusterHeight(
  stack: ReturnType<typeof computeNavigationBottomStack>,
  hasSpeedLimit: boolean,
): number {
  const c = stack.speedCluster;
  return (hasSpeedLimit ? c.limitSize + c.gap : 0) + c.speedSize;
}

let passed = 0;

for (const device of DEVICES) {
  const layout = computeNavigationScreenLayout(device);
  const centerY = anchorCenterY(
    device.height,
    layout.cameraPaddingTop,
    layout.cameraPaddingBottom,
  );
  const expectedAnchorY = device.height * NAV_ICON_SCREEN_RATIO;
  const bottomClearance = device.height - centerY;

  assert(
    Math.abs(centerY - expectedAnchorY) < 4,
    `${device.name}: centre caméra hors tolérance`,
  );
  assert(
    layout.cameraPaddingBottom >= device.height * 0.04,
    `${device.name}: padding bas insuffisant (barre trip)`,
  );
  assert(
    bottomClearance > layout.cameraPaddingBottom * 0.35,
    `${device.name}: véhicule trop proche du bord bas`,
  );
  assert(
    layout.cameraPaddingTop >= device.height * 0.08,
    `${device.name}: HUD top respecté`,
  );

  for (const hasSpeedLimit of [true, false]) {
    const stack = computeNavigationBottomStack(device, hasSpeedLimit);
    const tripBarPx = Math.round(device.height * TRIP_BAR_HEIGHT_RATIO);
    const toastTripGap = Math.round(device.height * TOAST_ABOVE_TRIP_RATIO);
    const toastClusterGap = Math.round(device.height * TOAST_CLUSTER_GAP_RATIO);
    const clusterVehicleGap = Math.round(device.height * CLUSTER_VEHICLE_GAP_RATIO);
    const c = stack.speedCluster;
    const cHeight = clusterHeight(stack, hasSpeedLimit);

    assert(
      stack.toast.bottom >= tripBarPx + toastTripGap - 2,
      `${device.name}: toast au-dessus barre trip`,
    );
    assert(
      c.bottom >= stack.toast.bottom + stack.toast.estimatedHeight + toastClusterGap - 2,
      `${device.name}: cluster vitesse au-dessus toast`,
    );
    assert(
      c.bottom + cHeight <= stack.vehicleZoneBottom - clusterVehicleGap + 2,
      `${device.name}: cluster sous zone véhicule`,
    );
    assert(
      c.left + c.speedSize < device.width * 0.22,
      `${device.name}: cluster vitesse dans marge gauche`,
    );
    assert(
      stack.toast.left + stack.toast.maxWidth <
        device.width / 2 - device.width * 0.08,
      `${device.name}: toast hors zone horizontale véhicule`,
    );
    assert(
      stack.toast.bottom + stack.toast.estimatedHeight + toastClusterGap <= c.bottom + 2,
      `${device.name}: ordre trip → toast → vitesse`,
    );
  }

  passed += 1;
  console.log(
    `OK ${device.platform.padEnd(7)} ${device.name.padEnd(18)} ` +
      `center=${Math.round(centerY)}/${device.height} ` +
      `padB=${layout.cameraPaddingBottom}`,
  );
}

console.log(`\ndriverNavigationDeviceValidation: ${passed}/${DEVICES.length} devices`);
