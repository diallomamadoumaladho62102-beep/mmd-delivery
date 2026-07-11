import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { computeNavigationScreenLayout } from "../lib/driverNavigationVisual";

export function useNavigationScreenLayout() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return useMemo(
    () =>
      computeNavigationScreenLayout(
        { width, height },
        {
          top: insets.top,
          bottom: insets.bottom,
          left: insets.left,
          right: insets.right,
        },
      ),
    [height, width, insets.top, insets.bottom, insets.left, insets.right],
  );
}
