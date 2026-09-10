import React, { useCallback, useEffect } from "react";
import { AccessibilityInfo, Alert, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useClientMmdAiVoiceSession } from "../../hooks/useClientMmdAiVoiceSession";
import {
  getMicrophonePermission,
  requestMicrophonePermission,
} from "../../lib/mmdAiSpeech";
import {
  voiceFabHintKey,
  voiceFabLabelKey,
  voiceFabStateKey,
} from "../../lib/mmdAiVoicePhase";
import { ClientRideMmdAiVoiceFab } from "./ClientRideMmdAiVoiceFab";

type Props = {
  screen: string;
  source: string;
  orderId?: string;
  rideId?: string;
  /** When set, the FAB sits on the live map instead of the bottom sheet. */
  mapHeight?: number;
};

export function ClientRideMmdAiVoiceHost({
  screen,
  source,
  orderId,
  rideId,
  mapHeight,
}: Props) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { phase, onPress } = useClientMmdAiVoiceSession({
    locale: i18n.language,
    enabled: true,
    context: { screen, source, orderId, rideId },
  });

  useEffect(() => {
    const label = t(voiceFabStateKey(phase), phase);
    AccessibilityInfo.announceForAccessibility(label);
  }, [phase, t]);

  const ensureMicrophone = useCallback(async (): Promise<boolean> => {
    const current = await getMicrophonePermission();
    if (current.granted) return true;

    const proceed = await new Promise<boolean>((resolve) => {
      Alert.alert(
        t("mmd.ai.voice.permissionTitle", "Microphone for MMD AI"),
        t(
          "mmd.ai.voice.permissionBody",
          "MMD AI uses the microphone only to hear your question. Chat by text still works if you decline.",
        ),
        [
          {
            text: t("mmd.ai.voice.notNow", "Not now"),
            style: "cancel",
            onPress: () => resolve(false),
          },
          {
            text: t("mmd.ai.voice.continue", "Continue"),
            onPress: () => resolve(true),
          },
        ],
        { cancelable: true },
      );
    });
    if (!proceed) return false;

    const granted = await requestMicrophonePermission();
    if (!granted) {
      Alert.alert(
        t("mmd.ai.voice.permissionDeniedTitle", "Microphone off"),
        t(
          "mmd.ai.voice.permissionDeniedBody",
          "You can keep using text chat. Enable the microphone in system settings to speak to MMD AI.",
        ),
      );
      return false;
    }
    return true;
  }, [t]);

  const handlePress = useCallback(() => {
    if (phase === "idle" || phase === "error" || phase === "ended") {
      void (async () => {
        const ok = await ensureMicrophone();
        if (!ok) return;
        onPress();
      })();
      return;
    }
    onPress();
  }, [ensureMicrophone, onPress, phase]);

  const top =
    mapHeight != null ? insets.top + Math.max(120, mapHeight) - 68 : undefined;
  const bottom = mapHeight == null ? insets.bottom + 88 : undefined;

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        top != null ? { top } : null,
        bottom != null ? { bottom } : null,
      ]}
    >
      <ClientRideMmdAiVoiceFab
        phase={phase}
        onPress={handlePress}
        badge={t("mmd.ai.voice.ride.badge", "AI")}
        accessibilityLabel={t(
          voiceFabLabelKey(phase),
          "Talk with MMD AI",
        )}
        accessibilityHint={t(
          voiceFabHintKey(phase),
          "Starts a voice conversation with MMD AI",
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    right: 16,
    zIndex: 40,
  },
});
