import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  Image,
  Pressable,
  StyleSheet,
  Linking,
  ActivityIndicator,
} from "react-native";
import type { ClientAdvertisement } from "../../../lib/clientAdvertisementsApi";
import { trackAdvertisementEvent } from "../../../lib/clientAdvertisementsApi";
import { RH, RH_SHADOW_SOFT } from "./restaurantHomeTheme";

type Props = {
  ad: ClientAdvertisement | null;
  loading?: boolean;
  country?: string | null;
  language?: string | null;
  onAction?: (ad: ClientAdvertisement) => void;
};

/**
 * Single sidebar ad slot — never hardcodes creative copy/images.
 * Empty when no eligible CMS row (placement = restaurant_sidebar).
 */
export function RestaurantSidebarAd({
  ad,
  loading,
  country,
  language,
  onAction,
}: Props) {
  const impressed = useRef<string | null>(null);

  useEffect(() => {
    if (!ad?.id) return;
    if (impressed.current === ad.id) return;
    impressed.current = ad.id;
    void trackAdvertisementEvent({
      event: "impression",
      advertisementId: ad.id,
      country: country ?? null,
      language: language ?? null,
      placement: "restaurant_sidebar",
    });
  }, [ad?.id, country, language]);

  if (loading) {
    return (
      <View style={styles.skeleton} accessibilityLabel="Loading advertisement">
        <ActivityIndicator color={RH.green} />
      </View>
    );
  }

  if (!ad) return null;

  const onPress = () => {
    void trackAdvertisementEvent({
      event: "click",
      advertisementId: ad.id,
      country: country ?? null,
      language: language ?? null,
      placement: "restaurant_sidebar",
    });
    if (onAction) {
      onAction(ad);
      return;
    }
    const action = String(ad.button_action ?? "").trim();
    if (action.startsWith("http://") || action.startsWith("https://")) {
      void Linking.openURL(action);
    }
  };

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}
      accessibilityRole="button"
      accessibilityLabel={ad.title}
    >
      <Image source={{ uri: ad.image_url }} style={styles.image} resizeMode="cover" />
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {ad.title}
        </Text>
        {ad.subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {ad.subtitle}
          </Text>
        ) : null}
        {ad.button_text ? (
          <View style={styles.cta}>
            <Text style={styles.ctaText} numberOfLines={1}>
              {ad.button_text}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    minHeight: 112,
    borderRadius: 16,
    backgroundColor: RH.muted,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 12,
    marginBottom: 12,
  },
  card: {
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#0F172A",
    ...RH_SHADOW_SOFT,
  },
  image: {
    width: "100%",
    height: 72,
    backgroundColor: "#1E293B",
  },
  body: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 17,
  },
  subtitle: {
    color: "rgba(226,232,240,0.85)",
    fontSize: 11,
    fontWeight: "500",
    lineHeight: 14,
  },
  cta: {
    alignSelf: "flex-start",
    marginTop: 6,
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  ctaText: {
    color: RH.text,
    fontSize: 11,
    fontWeight: "800",
  },
});
