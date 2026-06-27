import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { computeNavigationScreenLayout } from "../lib/driverNavigationVisual";

export function useNavigationScreenLayout() {
  const { width, height } = useWindowDimensions();
  return useMemo(
    () => computeNavigationScreenLayout({ width, height }),
    [height, width],
  );
}
