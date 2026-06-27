import {
  computeNavigationScreenLayout,
  NAV_ICON_SCREEN_RATIO,
} from "./driverNavigationVisual";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function anchorCenterY(
  height: number,
  paddingTop: number,
  paddingBottom: number,
): number {
  return paddingTop + (height - paddingTop - paddingBottom) / 2;
}

const screenSizes = [
  { label: "Android Pixel ref.", width: 1080, height: 2340 },
  { label: "Android window", width: 1080, height: 2212 },
  { label: "iPhone 15", width: 393, height: 852 },
  { label: "iPhone 15 Pro Max", width: 430, height: 932 },
  { label: "iPhone SE", width: 375, height: 667 },
];

for (const screen of screenSizes) {
  const layout = computeNavigationScreenLayout(screen);
  const centerY = anchorCenterY(
    screen.height,
    layout.cameraPaddingTop,
    layout.cameraPaddingBottom,
  );
  const expectedAnchorY = screen.height * NAV_ICON_SCREEN_RATIO;

  assert(
    Math.abs(centerY - expectedAnchorY) < 3,
    `${screen.label}: anchor Y (${centerY}) vs target (${expectedAnchorY})`,
  );
  assert(
    layout.cameraPaddingBottom > screen.height * 0.04,
    `${screen.label}: bottom padding covers trip bar`,
  );
  assert(
    layout.cameraPaddingBottom < screen.height * 0.14,
    `${screen.label}: bottom padding reasonable`,
  );
}

console.log("driverNavigationLayout.test: ok");
