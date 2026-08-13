import React from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { DriverBrandLoadingState } from "./DriverBrandLoadingState";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD_CLASSIC,
  MMD_MUTED,
  MMD_WHITE,
  mmdLogoSizeCompact,
} from "../../theme/mmdUi";

const MMD_LOGO = require("../../../assets/brand/mmd-logo-ui.png");

type Props = {
  variant:
    | "loading"
    | "missing_token"
    | "missing_order"
    | "missing_coords"
    | "permission_denied"
    | "route_error";
  message?: string;
  onGoBack?: () => void;
  onRetry?: () => void;
};

/**
 * Figma Driver Map fallback surfaces (286:5883 Loading, 286:5887 Error).
 */
export function DriverMapFallbackStates({
  variant,
  message,
  onGoBack,
  onRetry,
}: Props) {
  const { width, height } = useWindowDimensions();
  const logoSize = Math.min(40, mmdLogoSizeCompact(width, height));

  if (variant === "loading") {
    return (
      <DriverBrandLoadingState
        title="Preparing navigation…"
        logoAtBottom={false}
      />
    );
  }

  const content = getContent(variant, message);

  return (
    <View style={styles.root}>
      <View style={styles.content}>
        <View style={styles.feedback}>
          <Text style={styles.title}>{content.title}</Text>
          <Text style={styles.body}>{content.body}</Text>
        </View>

        <View style={styles.actions}>
          {onGoBack ? (
            <TouchableOpacity
              onPress={onGoBack}
              style={styles.btn}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Text style={styles.btnBackLabel}>Back</Text>
            </TouchableOpacity>
          ) : null}
          {onRetry ? (
            <TouchableOpacity
              onPress={onRetry}
              style={styles.btn}
              accessibilityRole="button"
              accessibilityLabel="Retry"
            >
              <Text style={styles.btnRetryLabel}>Retry</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.brandBlock}>
          <Image
            source={MMD_LOGO}
            style={{
              width: logoSize,
              height: logoSize,
              borderRadius: logoSize / 2,
            }}
            resizeMode="contain"
            accessibilityLabel="MMD Delivery"
          />
          <Text style={styles.brandLabel}>MMD Delivery</Text>
        </View>
      </View>
    </View>
  );
}

function getContent(variant: Props["variant"], message?: string) {
  switch (variant) {
    case "missing_token":
      return {
        title: "Navigation unavailable",
        body: "Mapbox token is missing. Contact MMD support before using driver navigation.",
      };
    case "missing_order":
      return {
        title: "Order not found",
        body: message || "Unable to load this trip.",
      };
    case "missing_coords":
      return {
        title: "GPS coordinates missing",
        body: "This trip has no valid coordinates yet. Return to order details.",
      };
    case "permission_denied":
      return {
        title: "Location permission denied",
        body: "Enable location access to use MMD navigation.",
      };
    case "route_error":
      return {
        title: "Route unavailable",
        body:
          message ||
          "Unable to calculate the route at this time. You can retry or open an external app from the details.",
      };
    default:
      return { title: "Error", body: message || "Something went wrong." };
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: MMD_BLUE,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  content: {
    alignItems: "center",
    gap: 18,
    maxWidth: 320,
  },
  feedback: {
    width: 280,
    padding: 20,
    alignItems: "center",
    gap: 8,
  },
  title: {
    color: "#FCA5A5",
    fontSize: 20,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    textAlign: "center",
  },
  body: {
    color: MMD_MUTED,
    fontSize: 15,
    fontFamily: MMD_FONT.regular,
    textAlign: "center",
    lineHeight: 22,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
  },
  btn: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: MMD_GOLD_CLASSIC,
    alignItems: "center",
    justifyContent: "center",
  },
  btnBackLabel: {
    color: "#6D28D9",
    fontSize: 14,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  btnRetryLabel: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  brandBlock: {
    alignItems: "center",
    gap: 8,
  },
  brandLabel: {
    color: MMD_GOLD_CLASSIC,
    fontSize: 12,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    textAlign: "center",
  },
});
