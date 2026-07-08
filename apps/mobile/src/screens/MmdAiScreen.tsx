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
import { V4, V4_RADIUS, V4_SHADOW } from "../components/client/home/clientHomeTheme";
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
import { rowDirection, textAlignStart } from "../i18n/rtl";

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
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
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
            <ActivityIndicator color={V4.green} style={{ marginTop: 24 }} />
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
              <ActivityIndicator color={V4.green} size="small" />
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
            placeholderTextColor={V4.textSecondary}
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
  safe: { flex: 1, backgroundColor: V4.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 10,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: V4.card,
    borderWidth: 1,
    borderColor: V4.border,
    alignItems: "center",
    justifyContent: "center",
  },
  backGlyph: { color: V4.textPrimary, fontSize: 20, fontWeight: "700" },
  headerCopy: { flex: 1, minWidth: 0 },
  headerTitle: { color: V4.textPrimary, fontSize: 20, fontWeight: "900" },
  headerSub: { color: V4.textSecondary, fontSize: 12, marginTop: 2, fontWeight: "600" },
  clearButton: { paddingHorizontal: 8, paddingVertical: 8 },
  clearText: { color: V4.textSecondary, fontWeight: "800", fontSize: 12 },
  quickRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 10 },
  quickChip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "rgba(0,217,95,0.12)",
    borderWidth: 1,
    borderColor: V4.borderGreen,
  },
  quickChipText: { color: V4.green, fontWeight: "800", fontSize: 12 },
  messagesContent: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
  emptyCard: {
    marginTop: 12,
    backgroundColor: V4.card,
    borderRadius: V4_RADIUS.lg,
    borderWidth: 1,
    borderColor: V4.border,
    padding: 18,
    alignItems: "center",
    ...V4_SHADOW,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(0,217,95,0.14)",
    borderWidth: 1,
    borderColor: V4.borderGreen,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  heroIconGlyph: { color: V4.green, fontSize: 22, fontWeight: "900" },
  emptyTitle: { color: V4.textPrimary, fontWeight: "900", fontSize: 18 },
  emptyBody: {
    color: V4.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 8,
    textAlign: "center",
  },
  noticeCard: {
    backgroundColor: "rgba(120,53,15,0.22)",
    borderRadius: V4_RADIUS.md,
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.22)",
    padding: 12,
  },
  noticeText: { color: "#FDE68A", fontWeight: "700", fontSize: 13, lineHeight: 19 },
  bubble: {
    maxWidth: "86%",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleUser: {
    alignSelf: "flex-end",
    backgroundColor: V4.green,
  },
  bubbleAssistant: {
    alignSelf: "flex-start",
    backgroundColor: V4.card,
    borderWidth: 1,
    borderColor: V4.border,
  },
  bubbleText: { fontSize: 15, lineHeight: 21, fontWeight: "600" },
  bubbleTextUser: { color: V4.bg },
  bubbleTextAssistant: { color: V4.textPrimary },
  typingBubble: { flexDirection: "row", alignItems: "center", gap: 10 },
  typingText: { color: V4.textSecondary, fontWeight: "700", fontSize: 13 },
  actionsBlock: { gap: 8, marginTop: 4 },
  actionCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: V4.cardSecondary,
    borderRadius: V4_RADIUS.sm,
    borderWidth: 1,
    borderColor: V4.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  actionLabel: { flex: 1, color: V4.textPrimary, fontWeight: "800", fontSize: 14 },
  actionChevron: { color: V4.textSecondary, fontSize: 18, fontWeight: "700" },
  suggestionsBlock: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  suggestionChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: V4.card,
    borderWidth: 1,
    borderColor: V4.border,
  },
  suggestionText: { color: V4.textSecondary, fontWeight: "700", fontSize: 12 },
  disclaimer: {
    color: V4.textSecondary,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
    opacity: 0.85,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: V4.border,
    backgroundColor: V4.bg,
  },
  input: {
    flex: 1,
    minHeight: 46,
    maxHeight: 120,
    borderRadius: 18,
    backgroundColor: V4.card,
    borderWidth: 1,
    borderColor: V4.border,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "android" ? 10 : 12,
    color: V4.textPrimary,
    fontSize: 15,
    fontWeight: "600",
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: V4.green,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: { opacity: 0.45 },
  sendGlyph: { color: V4.bg, fontSize: 20, fontWeight: "900" },
});
