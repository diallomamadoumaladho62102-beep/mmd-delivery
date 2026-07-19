import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { subscribeRestaurantOrderBanner } from "../lib/restaurantOrderAlertService";

type Props = {
  onPressOrder?: (orderId: string) => void;
};

export function RestaurantOrderAlertBanner({ onPressOrder }: Props) {
  const [banner, setBanner] = useState<{
    orderId: string;
    title: string;
    body: string;
  } | null>(null);

  useEffect(() => subscribeRestaurantOrderBanner(setBanner), []);

  if (!banner) return null;

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        onPress={() => onPressOrder?.(banner.orderId)}
        style={styles.card}
        testID="restaurant-order-alert-banner"
      >
        <Text style={styles.title}>{banner.title}</Text>
        <Text style={styles.body}>{banner.body}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 54,
    left: 12,
    right: 12,
    zIndex: 1000,
  },
  card: {
    backgroundColor: "#7F1D1D",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  title: {
    color: "#FEF2F2",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 2,
  },
  body: {
    color: "#FECACA",
    fontSize: 13,
  },
});
