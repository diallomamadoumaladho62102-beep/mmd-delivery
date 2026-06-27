/**
 * Validation cadrage véhicule — dimensions Android & iOS (sans simulateur iOS sur CI/Windows).
 */
import {
  computeNavigationScreenLayout,
  NAV_ICON_SCREEN_RATIO,
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

  passed += 1;
  console.log(
    `OK ${device.platform.padEnd(7)} ${device.name.padEnd(18)} ` +
      `center=${Math.round(centerY)}/${device.height} ` +
      `padB=${layout.cameraPaddingBottom}`,
  );
}

console.log(`\ndriverNavigationDeviceValidation: ${passed}/${DEVICES.length} devices`);
