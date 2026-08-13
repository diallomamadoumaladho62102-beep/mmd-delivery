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
      const known = routeName as keyof RootStackParamList;
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
        navigation.navigate("TaxiHome");
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
        const response = await postAiChat({
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
          },
          history: nextMessages.slice(-20).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        });

        const assistantMessage = createLocalMessage("assistant", response.message.content);
        const finalMessages = [...nextMessages, assistantMessage];
        await persist(finalMessages, response.conversationId);
        setActions(response.actions ?? []);
        setSuggestions(response.suggestions ?? []);
        setDisclaimer(response.meta?.disclaimer ?? null);
        setServiceUnavailable(null);
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
    [conversationId, i18n.language, input, market, messages, persist, route.params, sending, ts]
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
          },
        },
      ]
    );
  }, [ts]);

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]} testID="mmd-ai-screen">
      <ScreenHeader
        title={tsFallback(ts, "mmd.ai.title", "Ask MMD AI")}
        subtitle={tsFallback(ts, "mmd.ai.subtitle", "Your MMD assistant")}
        fallbackRoute="ClientHome"
        variant="dark"
        rightSlot={
          <Pressable onPress={handleClear} style={styles.clearButton} hitSlop={8}>
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
            <View style={styles.noticeCard}>
              <Text style={styles.noticeText}>{serviceUnavailable}</Text>
            </View>
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
          />
          <Pressable
            style={[styles.sendButton, (!input.trim() || sending) && styles.sendButtonDisabled]}
            onPress={() => void sendMessage()}
            disabled={!input.trim() || sending}
            testID="mmd-ai-send"
          >
            <Text style={styles.sendGlyph}>↑</Text>
          </Pressable>
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
