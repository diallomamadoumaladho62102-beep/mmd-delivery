import React, { useEffect, useRef } from "react";
import { Animated, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ProjectedSafetyEvent } from "../../lib/roadSafety";
import {
  confidenceLevel,
  formatSafetyDistanceLabel,
  safetyBadgeModel,
} from "../../lib/roadSafetyDisplay";
import {
  NAV_ELEVATION,
  NAV_RADIUS,
  NAV_SPACE,
  NAV_TYPO,
  navPalette,
  type NavColorScheme,
} from "../../theme/navigationTheme";
import { resolveNavigationLocale } from "../../lib/navigationLocale";
import { useReduceMotion } from "../../hooks/useReduceMotion";

type Props = {
  event: ProjectedSafetyEvent | null;
  locale: string;
  scheme?: NavColorScheme;
  topOffset: number;
};

const DISCLAIMER: Record<"en" | "fr" | "es", string> = {
  en: "Informative — real signage prevails",
  fr: "Alerte informative — la signalisation réelle prévaut",
  es: "Informativo — prevalece la señalización real",
};

/**
 * Premium contextual safety panel — compact, animated, never covers the route.
 * Shows the nearest relevant safety event with a clear hierarchy (icon, title,
 * distance) and an explicit informative disclaimer.
 */
export function DriverNavigationSafetyPanel({
  event,
  locale,
  scheme = "night",
  topOffset,
}: Props) {
  const reduceMotion = useReduceMotion();
  const palette = navPalette(scheme);
  const resolved = resolveNavigationLocale(locale);
  const anim = useRef(new Animated.Value(0)).current;
  const visible = !!event;

  useEffect(() => {
    if (reduceMotion) {
      anim.setValue(visible ? 1 : 0);
      return;
    }
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [anim, reduceMotion, visible]);

  if (!event) return null;

  const model = safetyBadgeModel(event.type, resolved);
  const confidence = confidenceLevel(event.confidence);
  const distanceLabel = formatSafetyDistanceLabel(event.distanceAheadMeters, resolved);
  const speedLabel =
    event.speedLimitKmh != null && event.speedLimitKmh > 0
      ? `${event.speedLimitKmh} km/h`
      : null;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: NAV_SPACE.md,
        right: NAV_SPACE.md,
        top: topOffset,
        zIndex: 39,
        opacity: anim,
        transform: [
          {
            translateY: anim.interpolate({
              inputRange: [0, 1],
              outputRange: [-10, 0],
            }),
          },
        ],
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          alignSelf: "flex-start",
          maxWidth: "100%",
          paddingVertical: NAV_SPACE.sm,
          paddingHorizontal: NAV_SPACE.md,
          borderRadius: NAV_RADIUS.md,
          backgroundColor: palette.surface,
          borderWidth: 1,
          borderColor: palette.surfaceBorder,
          ...NAV_ELEVATION.medium,
        }}
      >
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: NAV_RADIUS.sm,
            backgroundColor: model.colors.bg,
            borderWidth: 2,
            borderColor: model.colors.ring,
            alignItems: "center",
            justifyContent: "center",
            marginRight: NAV_SPACE.sm,
          }}
        >
          <Ionicons name={model.icon as never} size={18} color={model.colors.icon} />
        </View>

        <View style={{ flexShrink: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={{ color: palette.onSurface, ...NAV_TYPO.panelTitle }} numberOfLines={1}>
              {model.title}
            </Text>
            {speedLabel ? (
              <Text
                style={{
                  color: palette.onSurfaceMuted,
                  ...NAV_TYPO.panelCaption,
                  marginLeft: 6,
                }}
              >
                {speedLabel}
              </Text>
            ) : null}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 1 }}>
            <Text style={{ color: palette.accent, ...NAV_TYPO.panelDistance }}>
              {distanceLabel}
            </Text>
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                marginLeft: 8,
                backgroundColor:
                  confidence === "high"
                    ? palette.active
                    : confidence === "medium"
                      ? palette.warning
                      : palette.onSurfaceMuted,
              }}
            />
            <Text
              style={{
                color: palette.onSurfaceMuted,
                ...NAV_TYPO.panelCaption,
                marginLeft: 8,
                flexShrink: 1,
              }}
              numberOfLines={1}
            >
              {DISCLAIMER[resolved]}
            </Text>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}
