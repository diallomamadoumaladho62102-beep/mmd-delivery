import { I18nManager, type FlexStyle, type TextStyle } from "react-native";

export function isAppRtl(): boolean {
  return I18nManager.isRTL;
}

export function rowDirection(): FlexStyle["flexDirection"] {
  return isAppRtl() ? "row-reverse" : "row";
}

export function textAlignStart(): TextStyle["textAlign"] {
  return isAppRtl() ? "right" : "left";
}

export function textAlignEnd(): TextStyle["textAlign"] {
  return isAppRtl() ? "left" : "right";
}

export function mirrorChevron(value: "back" | "forward"): string {
  if (!isAppRtl()) return value === "back" ? "←" : "→";
  return value === "back" ? "→" : "←";
}
