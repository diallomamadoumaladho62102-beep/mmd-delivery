import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Alert,
  AccessibilityInfo,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../navigation/AppNavigator";
import ScreenHeader from "../components/navigation/ScreenHeader";
import {
  type AiAction,
  MmdAiApiError,
  postAiChat,
} from "../lib/mmdAiApi";
import {
  AUTH_ACTION_TIMEOUT_MS,
  withTimeout,
} from "../lib/bootFailOpen";
import {
  cancelMmdAiRecording,
  getMicrophonePermission,
  requestMicrophonePermission,
  startMmdAiRecording,
  stopMmdAiRecording,
  transcribeMmdAiAudio,
} from "../lib/mmdAiSpeech";
import { resolveAiVoiceLanguages } from "../lib/mmdAiVoiceLanguages";
import { speakMmdAiReply, stopMmdAiSpeech } from "../lib/mmdAiVoice";
import { canonicalizeClientAiRoute } from "../lib/aiClientRoutes";
import { getAlreadyGrantedClientCoords } from "../lib/mmdAiClientCoords";
import MarketScopeCard from "../components/market/MarketScopeCard";
import { useClientPlatformFeatures } from "../hooks/useClientPlatformFeatures";
import { resolveMarketScopeFromFeatures } from "../lib/marketScope";
import {
  clearAiLocalHistory,
  createLocalMessage,
  loadAiLocalHistory,
  saveAiLocalHistory,
  type LocalAiMessage,
} from "../lib/mmdAiLocalHistory";
import { textAlignStart } from "../i18n/rtl";
import {
  MMD_BLUE,
  MMD_CARD_ON_BLUE,
  MMD_FONT,
  MMD_GOLD_CLASSIC,
  MMD_GOLD_BORDER,
  MMD_LINK_BLUE,
  MMD_STROKE,
  MMD_TEXT,
  MMD_TEXT_MUTED_BLUE,
  MMD_WHITE,
} from "../theme/mmdUi";

type Nav = NativeStackNavigationProp<RootStackParamList, "MmdAi">;
type MmdAiRoute = RouteProp<RootStackParamList, "MmdAi">;

type AiInputMode = "text" | "voice" | "mixed";
type VoiceLiveState =
  | "idle"
  | "listening"
  | "processing"
  | "reply_ready"
  | "speaking"
  | "mic_error"
  | "mic_denied";

type QuickAction = {
  label: string;
  message: string;
  route?: keyof RootStackParamList;
};

function tsFallback(
  ts: (key: string, fallback: string) => string,
  key: string,
  fallback: string
) {
  return ts(key, fallback);
}

export default function MmdAiScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<MmdAiRoute>();
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const ts = useCallback(
    (key: string, fallback: string) => String(t(key, { defaultValue: fallback })),
    [t]
  );
  const scrollRef = useRef<ScrollView | null>(null);
  const { features: platformFeatures, loading: scopeLoading } = useClientPlatformFeatures();
  const market = useMemo(
    () => resolveMarketScopeFromFeatures(platformFeatures),
    [platformFeatures]
  );

  const [messages, setMessages] = useState<LocalAiMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState(route.params?.initialPrompt ?? "");
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [sending, setSending] = useState(false);
  const [actions, setActions] = useState<AiAction[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [disclaimer, setDisclaimer] = useState<string | null>(null);
  const [serviceUnavailable, setServiceUnavailable] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<AiInputMode>("mixed");
  const [voiceState, setVoiceState] = useState<VoiceLiveState>("idle");
  const [voiceFallbackNote, setVoiceFallbackNote] = useState<string | null>(null);
  const [requiresConfirmation, setRequiresConfirmation] = useState(false);
  const recordingRef = useRef(false);

  const quickActions = useMemo<QuickAction[]>(
    () => [
      {
        label: tsFallback(ts, "mmd.ai.quick.orderFood", "Order food"),
        message: tsFallback(ts, "mmd.ai.prompt.orderFood", "I want to order food"),
        route: "ClientRestaurantList",
      },
      {
        label: tsFallback(ts, "mmd.ai.quick.bookTaxi", "Book a taxi"),
        message: tsFallback(ts, "mmd.ai.prompt.bookTaxi", "I need a taxi"),
        route: "TaxiHome",
      },
      {
        label: tsFallback(ts, "mmd.ai.quick.sendPackage", "Send a package"),
        message: tsFallback(ts, "mmd.ai.prompt.sendPackage", "I want to send a package"),
        route: "DeliveryRequest",
      },
      {
        label: tsFallback(ts, "mmd.ai.quick.trackOrder", "Track my order"),
        message: tsFallback(ts, "mmd.ai.prompt.trackOrder", "Where is my order?"),
      },
      {
        label: tsFallback(ts, "mmd.ai.quick.support", "Contact support"),
        message: tsFallback(ts, "mmd.ai.prompt.support", "I need help from support"),
        route: "ClientInbox",
      },
    ],
    [ts]
  );

  const announceVoiceState = useCallback(
    (state: VoiceLiveState) => {
      const labels: Record<VoiceLiveState, string> = {
        idle: tsFallback(ts, "mmd.ai.voice.state.idle", "Voice idle"),
        listening: tsFallback(ts, "mmd.ai.voice.state.listening", "Listening"),
        processing: tsFallback(ts, "mmd.ai.voice.state.processing", "Processing your voice"),
        reply_ready: tsFallback(ts, "mmd.ai.voice.state.replyReady", "Reply available"),
        speaking: tsFallback(ts, "mmd.ai.voice.state.speaking", "Reading the reply"),
        mic_error: tsFallback(ts, "mmd.ai.voice.state.micError", "Microphone error"),
        mic_denied: tsFallback(ts, "mmd.ai.voice.state.micDenied", "Microphone permission denied"),
      };
      AccessibilityInfo.announceForAccessibility(labels[state]);
    },
    [ts]
  );

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const saved = await loadAiLocalHistory();
      if (!mounted) return;
      setConversationId(saved.conversationId);
      setMessages(saved.messages);
      setLoadingHistory(false);
      if (route.params?.initialPrompt?.trim()) {
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 200);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [route.params?.initialPrompt]);

  const persist = useCallback(async (nextMessages: LocalAiMessage[], nextConversationId: string) => {
    setConversationId(nextConversationId);
    setMessages(nextMessages);
    await saveAiLocalHistory({ conversationId: nextConversationId, messages: nextMessages });
  }, []);

  const navigateForRoute = useCallback(
    (routeName: string, params?: Record<string, unknown>) => {
      const resolved = canonicalizeClientAiRoute(routeName);
      const known = (resolved ?? routeName) as keyof RootStackParamList;
      if (known === "ClientOrderDetails" && params?.orderId) {
        navigation.navigate("ClientOrderDetails", { orderId: String(params.orderId) });
        return;
      }
      if (known === "ClientChat" && params?.orderId) {
        navigation.navigate("ClientChat", {
          orderId: String(params.orderId),
          targetRole: (params.targetRole as "driver" | "restaurant" | "admin") ?? "admin",
        });
        return;
      }
      if (known === "ClientDeliveryRequestDetails" && params?.requestId) {
        navigation.navigate("ClientDeliveryRequestDetails", {
          requestId: String(params.requestId ?? params.orderId),
        });
        return;
      }
      if (known === "ClientInbox") {
        navigation.navigate("ClientInbox");
        return;
      }
      if (known === "ClientRestaurantList") {
        navigation.navigate("ClientRestaurantList");
        return;
      }
      if (known === "TaxiHome") {
        navigation.navigate("TaxiHome", {
          pickupAddress: params?.pickupAddress ? String(params.pickupAddress) : undefined,
          dropoffAddress: params?.dropoffAddress ? String(params.dropoffAddress) : undefined,
          pickupLat: Number.isFinite(Number(params?.pickupLat)) ? Number(params?.pickupLat) : undefined,
          pickupLng: Number.isFinite(Number(params?.pickupLng)) ? Number(params?.pickupLng) : undefined,
          dropoffLat: Number.isFinite(Number(params?.dropoffLat)) ? Number(params?.dropoffLat) : undefined,
          dropoffLng: Number.isFinite(Number(params?.dropoffLng)) ? Number(params?.dropoffLng) : undefined,
          vehicleClass: params?.vehicleClass ? String(params.vehicleClass) : undefined,
          countryCode: params?.countryCode ? String(params.countryCode) : undefined,
          pickupLocationId: params?.pickupLocationId ? String(params.pickupLocationId) : undefined,
          dropoffLocationId: params?.dropoffLocationId ? String(params.dropoffLocationId) : undefined,
        });
        return;
      }
      if (known === "TaxiRideTracking" && params?.rideId) {
        navigation.navigate("TaxiRideTracking", { rideId: String(params.rideId) });
        return;
      }
      if (known === "ClientRestaurantMenu" && params?.restaurantId) {
        const rawItems = Array.isArray(params.items)
          ? params.items
          : Array.isArray(params.initialItems)
            ? params.initialItems
            : undefined;
        navigation.navigate("ClientRestaurantMenu", {
          restaurantId: String(params.restaurantId),
          restaurantName: String(params.restaurantName ?? "Restaurant"),
          initialItems: rawItems as
            | { item_id: string; quantity: number; options?: unknown }[]
            | undefined,
        });
        return;
      }
      if (known === "DeliveryRequest") {
        navigation.navigate("DeliveryRequest");
        return;
      }
      Alert.alert(
        tsFallback(ts, "mmd.ai.navigateUnavailable.title", "Navigation"),
        tsFallback(ts, "mmd.ai.navigateUnavailable.body", "This action is not available yet.")
      );
    },
    [navigation, ts]
  );

  const sendMessage = useCallback(
    async (rawText?: string) => {
      const text = String(rawText ?? input).trim();
      if (!text || sending) return;

      setInput("");
      setSending(true);
      setServiceUnavailable(null);
      setActions([]);
      setSuggestions([]);

      const userMessage = createLocalMessage("user", text);
      const nextMessages = [...messages, userMessage];
      setMessages(nextMessages);
      scrollRef.current?.scrollToEnd({ animated: true });

      try {
        const grantedCoords = await getAlreadyGrantedClientCoords();
        const response = await withTimeout(
          postAiChat({
          message: text,
          conversationId: conversationId ?? undefined,
          locale: (i18n.language || "en").split("-")[0],
          context: {
            role: "client",
            screen: "MmdAi",
            orderId: route.params?.orderId,
            source: route.params?.source ?? "home_tab",
            countryCode: market.countryCode || undefined,
            stateCode: market.stateCode ?? undefined,
            regionCode: market.regionCode ?? undefined,
            currencyCode: market.currencyCode || undefined,
            ...(grantedCoords
              ? { latitude: grantedCoords.latitude, longitude: grantedCoords.longitude }
              : {}),
          },
          history: nextMessages.slice(-20).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
          AUTH_ACTION_TIMEOUT_MS,
          "mmd_ai_chat",
        );

        const assistantMessage = createLocalMessage("assistant", response.message.content);
        const finalMessages = [...nextMessages, assistantMessage];
        await persist(finalMessages, response.conversationId);
        setActions(response.actions ?? []);
        setSuggestions(response.suggestions ?? []);
        setDisclaimer(response.meta?.disclaimer ?? null);
        setRequiresConfirmation(response.meta?.requiresConfirmation === true);
        setServiceUnavailable(null);
        if (inputMode !== "text" && response.message.content) {
          setVoiceState("speaking");
          announceVoiceState("speaking");
          const spoken = await speakMmdAiReply(response.message.content, i18n.language);
          if (spoken.usedFallback) {
            setVoiceFallbackNote(
              tsFallback(
                ts,
                "mmd.ai.voice.languageFallback",
                "Voice reply is using English because this language is not available on the device."
              )
            );
          }
          setVoiceState("reply_ready");
          announceVoiceState("reply_ready");
        }
      } catch (err) {
        const apiErr = err instanceof MmdAiApiError ? err : null;
        const code = apiErr?.code;
        const fallback =
          code === "AI_DISABLED" || code === "AI_NOT_AVAILABLE_IN_REGION"
            ? tsFallback(
                ts,
                code === "AI_NOT_AVAILABLE_IN_REGION"
                  ? "mmd.ai.regionUnavailable"
                  : "mmd.ai.disabled",
                "MMD AI is not available in your area yet."
              )
            : code === "AI_TEMPORARILY_DISABLED"
              ? tsFallback(
                  ts,
                  "mmd.ai.temporarilyDisabled",
                  "MMD AI is temporarily unavailable."
                )
              : code === "AI_RATE_LIMIT"
                ? tsFallback(
                    ts,
                    "mmd.ai.rateLimit",
                    "Too many requests. Please try again in a few minutes."
                  )
                : apiErr?.message ??
                  tsFallback(ts, "mmd.ai.error.generic", "MMD AI is temporarily unavailable.");

        if (
          code === "AI_DISABLED" ||
          code === "AI_NOT_AVAILABLE_IN_REGION" ||
          code === "AI_TEMPORARILY_DISABLED"
        ) {
          setServiceUnavailable(fallback);
        } else {
          const assistantMessage = createLocalMessage("assistant", fallback);
          const finalMessages = [...nextMessages, assistantMessage];
          if (conversationId) {
            await saveAiLocalHistory({ conversationId, messages: finalMessages });
          }
          setMessages(finalMessages);
        }
      } finally {
        setSending(false);
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
      }
    },
    [conversationId, i18n.language, input, inputMode, market, messages, persist, route.params, sending, ts, announceVoiceState]
  );

  const handleAiAction = useCallback(
    (action: AiAction) => {
      if (action.type === "quick_reply") {
        void sendMessage(action.label);
        return;
      }
      navigateForRoute(action.route, action.params);
    },
    [navigateForRoute, sendMessage]
  );

  const handleClear = useCallback(() => {
    Alert.alert(
      tsFallback(ts, "mmd.ai.clear.title", "Clear conversation"),
      tsFallback(ts, "mmd.ai.clear.body", "Remove local chat history on this device?"),
      [
        { text: tsFallback(ts, "common.cancel", "Cancel"), style: "cancel" },
        {
          text: tsFallback(ts, "common.clear", "Clear"),
          style: "destructive",
          onPress: () => {
            void clearAiLocalHistory();
            setMessages([]);
            setConversationId(null);
            setActions([]);
            setSuggestions([]);
            setDisclaimer(null);
            setServiceUnavailable(null);
            setRequiresConfirmation(false);
            void stopMmdAiSpeech();
          },
        },
      ]
    );
  }, [ts]);

  const ensureMicrophone = useCallback(async (): Promise<boolean> => {
    const current = await getMicrophonePermission();
    if (current.granted) return true;

    const proceed = await new Promise<boolean>((resolve) => {
      Alert.alert(
        tsFallback(ts, "mmd.ai.voice.permissionTitle", "Microphone for MMD AI"),
        tsFallback(
          ts,
          "mmd.ai.voice.permissionBody",
          "MMD AI uses the microphone only to hear your question. Chat by text still works if you decline."
        ),
        [
          {
            text: tsFallback(ts, "mmd.ai.voice.notNow", "Not now"),
            style: "cancel",
            onPress: () => resolve(false),
          },
          {
            text: tsFallback(ts, "mmd.ai.voice.continue", "Continue"),
            onPress: () => resolve(true),
          },
        ],
        { cancelable: true }
      );
    });
    if (!proceed) {
      setVoiceState("mic_denied");
      announceVoiceState("mic_denied");
      return false;
    }

    const granted = await requestMicrophonePermission();
    if (!granted) {
      setVoiceState("mic_denied");
      announceVoiceState("mic_denied");
      Alert.alert(
        tsFallback(ts, "mmd.ai.voice.permissionDeniedTitle", "Microphone off"),
        tsFallback(
          ts,
          "mmd.ai.voice.permissionDeniedBody",
          "You can keep using text chat. Enable the microphone in system settings to speak to MMD AI."
        )
      );
      return false;
    }
    return true;
  }, [announceVoiceState, ts]);

  const handleMicPress = useCallback(async () => {
    if (sending) return;
    try {
      if (recordingRef.current) {
        recordingRef.current = false;
        setVoiceState("processing");
        announceVoiceState("processing");
        const uri = await stopMmdAiRecording();
        if (!uri) {
          setVoiceState("mic_error");
          announceVoiceState("mic_error");
          return;
        }
        const locale = resolveAiVoiceLanguages(i18n.language);
        const text = await transcribeMmdAiAudio({
          uri,
          locale: locale.sttLanguage ?? locale.appLocale,
        });
        if (locale.sttFallback) {
          setVoiceFallbackNote(
            tsFallback(
              ts,
              "mmd.ai.voice.sttFallback",
              "Voice input is using automatic language detection for this app language."
            )
          );
        }
        if (!text) {
          setVoiceState("mic_error");
          announceVoiceState("mic_error");
          return;
        }
        await sendMessage(text);
        return;
      }

      const ok = await ensureMicrophone();
      if (!ok) return;
      await stopMmdAiSpeech();
      await startMmdAiRecording();
      recordingRef.current = true;
      setVoiceState("listening");
      announceVoiceState("listening");
    } catch {
      recordingRef.current = false;
      await cancelMmdAiRecording();
      setVoiceState("mic_error");
      announceVoiceState("mic_error");
    }
  }, [announceVoiceState, ensureMicrophone, i18n.language, sendMessage, sending, ts]);

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]} testID="mmd-ai-screen">
      <ScreenHeader
        title={tsFallback(ts, "mmd.ai.title", "Ask MMD AI")}
        subtitle={tsFallback(ts, "mmd.ai.subtitle", "Your MMD assistant")}
        fallbackRoute="ClientHome"
        variant="dark"
        rightSlot={
          <Pressable onPress={handleClear} style={styles.clearButton} hitSlop={8} accessibilityRole="button" accessibilityLabel={tsFallback(ts, "mmd.ai.clear.short", "Clear")}>
            <Text style={styles.clearText}>{tsFallback(ts, "mmd.ai.clear.short", "Clear")}</Text>
          </Pressable>
        }
      />

      {market.scopeResolved ? (
        <View style={styles.marketBand}>
          <MarketScopeCard
            market={market}
            areaLabel={tsFallback(ts, "mmd.ai.market", "Your market")}
            currencyLabel={tsFallback(ts, "mmd.ai.currency", "Currency")}
            loading={scopeLoading}
            variant="light"
          />
        </View>
      ) : null}

      <View style={styles.modeRow} accessibilityRole="tablist">
        {(["text", "voice", "mixed"] as AiInputMode[]).map((mode) => {
          const labels: Record<AiInputMode, string> = {
            text: tsFallback(ts, "mmd.ai.mode.text", "Text chat"),
            voice: tsFallback(ts, "mmd.ai.mode.voice", "Voice"),
            mixed: tsFallback(ts, "mmd.ai.mode.mixed", "Text and voice"),
          };
          const selected = inputMode === mode;
          return (
            <Pressable
              key={mode}
              style={[styles.modeChip, selected && styles.modeChipActive]}
              onPress={() => setInputMode(mode)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={labels[mode]}
              testID={`mmd-ai-mode-${mode}`}
            >
              <Text style={[styles.modeChipText, selected && styles.modeChipTextActive]}>
                {labels[mode]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.quickRow}
        style={styles.quickBand}
      >
        {quickActions.map((action) => (
          <Pressable
            key={action.label}
            style={styles.quickChip}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={() => {
              if (action.route) {
                navigation.navigate(action.route as never);
                return;
              }
              void sendMessage(action.message);
            }}
          >
            <Text style={styles.quickChipText}>{action.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.messagesContent}
          showsVerticalScrollIndicator={false}
          testID="mmd-ai-messages"
        >
          {loadingHistory ? (
            <ActivityIndicator color={MMD_GOLD_CLASSIC} style={{ marginTop: 24 }} />
          ) : messages.length === 0 ? (
            <View style={styles.emptyCard}>
              <View style={styles.heroIcon}>
                <Text style={styles.heroIconGlyph}>◆</Text>
              </View>
              <Text style={styles.emptyTitle}>
                {tsFallback(ts, "mmd.ai.empty.title", "How can I help?")}
              </Text>
              <Text style={styles.emptyBody}>
                {tsFallback(
                  ts,
                  "mmd.ai.empty.body",
                  "Ask about food, taxi, delivery, your orders, or support."
                )}
              </Text>
            </View>
          ) : null}

          {serviceUnavailable ? (
            <View style={styles.noticeCard} accessibilityLiveRegion="polite">
              <Text style={styles.noticeText}>{serviceUnavailable}</Text>
            </View>
          ) : null}

          {requiresConfirmation ? (
            <View
              style={styles.confirmCard}
              accessibilityLiveRegion="polite"
              accessibilityLabel={tsFallback(
                ts,
                "mmd.ai.confirm.banner",
                "Confirmation required. MMD AI will not take payment. Continue in Taxi or restaurant checkout."
              )}
            >
              <Text style={styles.confirmText}>
                {tsFallback(
                  ts,
                  "mmd.ai.confirm.banner",
                  "Confirmation required. MMD AI will not take payment. Continue in Taxi or restaurant checkout."
                )}
              </Text>
            </View>
          ) : null}

          {voiceState !== "idle" ? (
            <Text
              style={styles.voiceStatus}
              accessibilityLiveRegion="polite"
              testID="mmd-ai-voice-status"
            >
              {voiceState === "listening"
                ? tsFallback(ts, "mmd.ai.voice.state.listening", "Listening")
                : voiceState === "processing"
                  ? tsFallback(ts, "mmd.ai.voice.state.processing", "Processing your voice")
                  : voiceState === "speaking"
                    ? tsFallback(ts, "mmd.ai.voice.state.speaking", "Reading the reply")
                    : voiceState === "reply_ready"
                      ? tsFallback(ts, "mmd.ai.voice.state.replyReady", "Reply available")
                      : voiceState === "mic_denied"
                        ? tsFallback(ts, "mmd.ai.voice.state.micDenied", "Microphone permission denied")
                        : voiceState === "mic_error"
                          ? tsFallback(ts, "mmd.ai.voice.state.micError", "Microphone error")
                          : ""}
            </Text>
          ) : null}

          {voiceFallbackNote ? (
            <Text style={styles.voiceFallback}>{voiceFallbackNote}</Text>
          ) : null}

          {messages.map((message) => (
            <View
              key={message.id}
              style={[
                styles.bubble,
                message.role === "user" ? styles.bubbleUser : styles.bubbleAssistant,
              ]}
            >
              <Text
                style={[
                  styles.bubbleText,
                  message.role === "user" ? styles.bubbleTextUser : styles.bubbleTextAssistant,
                  { textAlign: textAlignStart() },
                ]}
              >
                {message.content}
              </Text>
            </View>
          ))}

          {sending ? (
            <View style={[styles.bubble, styles.bubbleAssistant, styles.typingBubble]}>
              <ActivityIndicator color={MMD_GOLD_CLASSIC} size="small" />
              <Text style={styles.typingText}>
                {tsFallback(ts, "mmd.ai.typing", "MMD AI is thinking…")}
              </Text>
            </View>
          ) : null}

          {actions.length > 0 ? (
            <View style={styles.actionsBlock}>
              {actions.map((action) => (
                <Pressable
                  key={`${action.type}-${action.label}`}
                  style={styles.actionCard}
                  onPress={() => handleAiAction(action)}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                >
                  <Text style={styles.actionLabel}>{action.label}</Text>
                  <Text style={styles.actionChevron}>›</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {suggestions.length > 0 ? (
            <View style={styles.suggestionsBlock}>
              {suggestions.slice(0, 4).map((suggestion) => (
                <Pressable
                  key={suggestion}
                  style={styles.suggestionChip}
                  onPress={() => void sendMessage(suggestion)}
                >
                  <Text style={styles.suggestionText}>{suggestion}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {disclaimer ? <Text style={styles.disclaimer}>{disclaimer}</Text> : null}
        </ScrollView>

        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          {inputMode !== "voice" ? (
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder={tsFallback(ts, "mmd.ai.input.placeholder", "Ask MMD anything…")}
              placeholderTextColor={MMD_LINK_BLUE}
              style={[styles.input, { textAlign: textAlignStart() }]}
              multiline
              maxLength={2000}
              editable={!sending}
              testID="mmd-ai-input"
              accessibilityLabel={tsFallback(ts, "mmd.ai.input.placeholder", "Ask MMD anything…")}
            />
          ) : (
            <Text style={styles.voiceHint} accessibilityLiveRegion="polite">
              {tsFallback(
                ts,
                "mmd.ai.voice.handsFreeHint",
                "Voice mode: tap the microphone to speak. You do not need the keyboard."
              )}
            </Text>
          )}
          {inputMode !== "text" ? (
            <Pressable
              style={[
                styles.micButton,
                voiceState === "listening" && styles.micButtonActive,
                sending && styles.sendButtonDisabled,
              ]}
              onPress={() => void handleMicPress()}
              disabled={sending}
              accessibilityRole="button"
              accessibilityLabel={
                voiceState === "listening"
                  ? tsFallback(ts, "mmd.ai.voice.micStop", "Stop listening")
                  : tsFallback(ts, "mmd.ai.voice.micStart", "Speak to MMD AI")
              }
              accessibilityHint={tsFallback(
                ts,
                "mmd.ai.voice.micHint",
                "Double tap to start or stop voice input"
              )}
              accessibilityState={{ disabled: sending, selected: voiceState === "listening" }}
              testID="mmd-ai-mic"
            >
              <Text style={styles.micGlyph}>
                {voiceState === "listening" ? "■" : "○"}
              </Text>
            </Pressable>
          ) : null}
          {inputMode !== "voice" ? (
            <Pressable
              style={[styles.sendButton, (!input.trim() || sending) && styles.sendButtonDisabled]}
              onPress={() => void sendMessage()}
              disabled={!input.trim() || sending}
              testID="mmd-ai-send"
              accessibilityRole="button"
              accessibilityLabel={tsFallback(ts, "mmd.ai.send", "Send message")}
            >
              <Text style={styles.sendGlyph}>↑</Text>
            </Pressable>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  flex: { flex: 1 },
  clearButton: { paddingHorizontal: 8, paddingVertical: 8 },
  clearText: {
    color: MMD_TEXT_MUTED_BLUE,
    fontWeight: "800",
    fontSize: 12,
    fontFamily: MMD_FONT.extrabold,
  },
  marketBand: {
    backgroundColor: MMD_WHITE,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  modeRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: MMD_WHITE,
  },
  modeChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    backgroundColor: MMD_WHITE,
  },
  modeChipActive: {
    backgroundColor: "#DCFCE7",
  },
  modeChipText: {
    color: MMD_BLUE,
    fontWeight: "800",
    fontSize: 12,
    fontFamily: MMD_FONT.extrabold,
  },
  modeChipTextActive: {
    color: MMD_GOLD_CLASSIC,
  },
  quickBand: { backgroundColor: MMD_WHITE, maxHeight: 55 },
  quickRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 10 },
  quickChip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#DCFCE7",
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
  },
  quickChipText: {
    color: MMD_GOLD_CLASSIC,
    fontWeight: "800",
    fontSize: 12,
    fontFamily: MMD_FONT.extrabold,
  },
  messagesContent: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
  emptyCard: {
    marginTop: 0,
    backgroundColor: MMD_WHITE,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    padding: 18,
    alignItems: "center",
    gap: 8,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#DCFCE7",
    borderWidth: 1,
    borderColor: MMD_GOLD_BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  heroIconGlyph: {
    color: MMD_GOLD_CLASSIC,
    fontSize: 22,
    fontWeight: "900",
    fontFamily: MMD_FONT.extrabold,
  },
  emptyTitle: {
    color: MMD_BLUE,
    fontWeight: "900",
    fontSize: 18,
    fontFamily: MMD_FONT.extrabold,
  },
  emptyBody: {
    color: MMD_LINK_BLUE,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    fontFamily: MMD_FONT.regular,
  },
  noticeCard: {
    backgroundColor: "rgba(120,53,15,0.22)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.22)",
    padding: 12,
  },
  noticeText: {
    color: "#FDE68A",
    fontWeight: "700",
    fontSize: 13,
    lineHeight: 19,
    fontFamily: MMD_FONT.bold,
  },
  confirmCard: {
    backgroundColor: "#DCFCE7",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    padding: 12,
  },
  confirmText: {
    color: MMD_BLUE,
    fontWeight: "700",
    fontSize: 13,
    lineHeight: 19,
    fontFamily: MMD_FONT.bold,
  },
  voiceStatus: {
    color: MMD_GOLD_CLASSIC,
    fontWeight: "800",
    fontSize: 13,
    fontFamily: MMD_FONT.extrabold,
  },
  voiceFallback: {
    color: MMD_TEXT_MUTED_BLUE,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: MMD_FONT.regular,
  },
  voiceHint: {
    flex: 1,
    color: MMD_LINK_BLUE,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: MMD_FONT.regular,
    paddingVertical: 10,
  },
  micButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: MMD_BLUE,
    alignItems: "center",
    justifyContent: "center",
  },
  micButtonActive: {
    backgroundColor: MMD_GOLD_CLASSIC,
  },
  micGlyph: {
    color: MMD_WHITE,
    fontSize: 18,
    fontWeight: "900",
    fontFamily: MMD_FONT.extrabold,
  },
  bubble: {
    maxWidth: "86%",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleUser: {
    alignSelf: "flex-end",
    backgroundColor: "rgba(114,159,250,0.32)",
    borderWidth: 1,
    borderColor: MMD_STROKE,
  },
  bubbleAssistant: {
    alignSelf: "flex-start",
    backgroundColor: MMD_CARD_ON_BLUE,
    borderWidth: 1,
    borderColor: MMD_STROKE,
  },
  bubbleText: { fontSize: 15, lineHeight: 21, fontWeight: "600", fontFamily: MMD_FONT.semibold },
  bubbleTextUser: { color: MMD_WHITE },
  bubbleTextAssistant: { color: MMD_TEXT },
  typingBubble: { flexDirection: "row", alignItems: "center", gap: 10 },
  typingText: {
    color: MMD_TEXT_MUTED_BLUE,
    fontWeight: "700",
    fontSize: 13,
    fontFamily: MMD_FONT.bold,
  },
  actionsBlock: { gap: 8, marginTop: 4 },
  actionCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: MMD_CARD_ON_BLUE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: MMD_STROKE,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  actionLabel: {
    flex: 1,
    color: MMD_TEXT,
    fontWeight: "800",
    fontSize: 14,
    fontFamily: MMD_FONT.extrabold,
  },
  actionChevron: {
    color: MMD_TEXT_MUTED_BLUE,
    fontSize: 18,
    fontWeight: "700",
  },
  suggestionsBlock: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  suggestionChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#DCFCE7",
    borderWidth: 1,
    borderColor: MMD_STROKE,
  },
  suggestionText: {
    color: MMD_GOLD_CLASSIC,
    fontWeight: "700",
    fontSize: 12,
    fontFamily: MMD_FONT.bold,
  },
  disclaimer: {
    color: MMD_TEXT_MUTED_BLUE,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
    opacity: 0.85,
    fontFamily: MMD_FONT.regular,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    backgroundColor: MMD_WHITE,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    borderRadius: 8,
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "android" ? 10 : 12,
    color: MMD_BLUE,
    fontSize: 14,
    fontWeight: "600",
    fontFamily: MMD_FONT.regular,
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: MMD_GOLD_CLASSIC,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: { opacity: 0.45 },
  sendGlyph: {
    color: MMD_WHITE,
    fontSize: 20,
    fontWeight: "900",
    fontFamily: MMD_FONT.extrabold,
  },
});
