import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useReduceMotion } from "../../hooks/useReduceMotion";
import {
  voiceFabIcon,
  voiceFabTint,
  type MmdAiVoicePhase,
} from "../../lib/mmdAiVoicePhase";

type Props = {
  phase: MmdAiVoicePhase;
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint: string;
  badge: string;
};

const SIZE = 56;

export function ClientRideMmdAiVoiceFab({
  phase,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  badge,
}: Props) {
  const reduceMotion = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const tint = voiceFabTint(phase);
  const icon = voiceFabIcon(phase);
  const listening = phase === "listening";
  const busy = phase === "connecting" || phase === "thinking";

  useEffect(() => {
    if (reduceMotion || !listening) {
      pulse.stopAnimation();
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.08,
          duration: 650,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 650,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      pulse.setValue(1);
    };
  }, [listening, pulse, reduceMotion]);

  const pressTo = (value: number) => {
    if (reduceMotion) return;
    Animated.spring(scale, {
      toValue: value,
      useNativeDriver: true,
      friction: 7,
      tension: 240,
    }).start();
  };

  return (
    <Animated.View style={{ transform: [{ scale: Animated.multiply(scale, pulse) }] }}>
      <Pressable
        testID="client-ride-mmd-ai-voice-fab"
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{
          busy,
          selected: listening || phase === "speaking",
        }}
        onPressIn={() => pressTo(0.94)}
        onPressOut={() => pressTo(1)}
        onPress={onPress}
        hitSlop={8}
        style={[styles.btn, { backgroundColor: tint }]}
      >
        <Ionicons name={icon} size={26} color="#FFFFFF" />
        <View style={styles.badge} importantForAccessibility="no">
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.88)",
    shadowColor: "#0F172A",
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  badge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    minWidth: 22,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: "#003399",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
});
