import React, { useCallback, useEffect, useRef, useState } from "react";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  ScrollView,
  TextInput,
  Alert,
  Image,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { decode } from "base64-arraybuffer";
import * as FileSystem from "expo-file-system/legacy";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import { supabase } from "../../lib/supabase";
import {
  subscribePostgresChannel,
  unsubscribeSupabaseChannel,
} from "../../lib/supabaseRealtime";
import { formatDateTime } from "../../i18n/formatters";
import { textAlignStart } from "../../i18n/rtl";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import { DriverBrandLoadingState } from "../../components/driver/DriverBrandLoadingState";
import {
  MMD_ACTION_NAVY,
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD_CLASSIC,
  MMD_TAXI_GREEN,
  MMD_TEXT,
  MMD_WHITE,
} from "../../theme/mmdUi";

type ChatRoute = RouteProp<RootStackParamList, "DriverTaxiChat">;

type TaxiMessage = {
  id: string;
  user_id: string;
  text: string | null;
  image_path: string | null;
  created_at: string;
  _signedUrl?: string | null;
};

const TAXI_IMAGES_BUCKET = "taxi-images";
const MMD_LOGO = require("../../../assets/brand/mmd-logo-ui.png");

export default function DriverTaxiChatScreen() {
  const route = useRoute<ChatRoute>();
  const { t, i18n } = useTranslation();
  const rideId = route.params?.rideId;
  const scrollRef = useRef<ScrollView | null>(null);

  const [messages, setMessages] = useState<TaxiMessage[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    setUserId(sessionData.session?.user?.id ?? null);

    const { data, error } = await supabase
      .from("taxi_messages")
      .select("id,user_id,text,image_path,created_at")
      .eq("taxi_ride_id", rideId)
      .order("created_at", { ascending: true });

    if (error) {
      setMessages([]);
      return;
    }

    const rows = (data ?? []) as TaxiMessage[];
    const enriched = await Promise.all(
      rows.map(async (row) => {
        if (!row.image_path) return row;
        const { data: signed } = await supabase.storage
          .from(TAXI_IMAGES_BUCKET)
          .createSignedUrl(row.image_path, 60 * 30);
        return { ...row, _signedUrl: signed?.signedUrl ?? null };
      })
    );
    setMessages(enriched);
  }, [rideId]);

  useEffect(() => {
    void load().finally(() => setLoading(false));
    const channel = subscribePostgresChannel(`taxi_messages_driver:${rideId}`, [
      {
        event: "*",
        table: "taxi_messages",
        filter: `taxi_ride_id=eq.${rideId}`,
        callback: () => void load(),
      },
    ]);
    return () => {
      void unsubscribeSupabaseChannel(channel);
    };
  }, [load, rideId]);

  async function sendMessage() {
    const body = text.trim();
    if (!body || !userId) return;
    setSending(true);
    try {
      const { error } = await supabase.from("taxi_messages").insert({
        taxi_ride_id: rideId,
        user_id: userId,
        sender_role: "driver",
        target_role: "client",
        text: body,
      });
      if (error) throw error;
      setText("");
      await load();
    } catch (e: unknown) {
      Alert.alert(
        t("taxi.chat.sendFailed", "Send failed"),
        toUserFacingError(e, t("taxi.chat.send", "Error"))
      );
    } finally {
      setSending(false);
    }
  }

  async function sendImageMessage() {
    if (!userId) return;

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });

    if (picked.canceled || !picked.assets?.[0]?.uri) return;

    setSending(true);
    try {
      const asset = picked.assets[0];
      const ext = asset.uri.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${rideId}/${Date.now()}.${ext}`;
      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const { error: uploadError } = await supabase.storage
        .from(TAXI_IMAGES_BUCKET)
        .upload(path, decode(base64), {
          contentType: `image/${ext === "png" ? "png" : "jpeg"}`,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { error } = await supabase.from("taxi_messages").insert({
        taxi_ride_id: rideId,
        user_id: userId,
        sender_role: "driver",
        target_role: "client",
        image_path: path,
      });

      if (error) throw error;
      await load();
    } catch (e: unknown) {
      Alert.alert(
        t("taxi.chat.imageFailed", "Image failed"),
        toUserFacingError(e, t("taxi.chat.send", "Error"))
      );
    } finally {
      setSending(false);
    }
  }

  const brandFooter = (
    <View style={styles.footer}>
      <Image
        source={MMD_LOGO}
        style={styles.footerLogo}
        resizeMode="contain"
        accessibilityLabel="MMD Delivery"
      />
      <Text style={styles.footerBrand}>MMD Delivery</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader
        title={t("taxi.chat.driverTitle", "Taxi Chat")}
        subtitle={t("taxi.chat.driverSubtitle", "Ride conversation")}
        fallbackRoute="DriverTabs"
        variant="mmd"
      />

      {loading ? (
        <DriverBrandLoadingState
          title={t("taxi.chat.loading", "Loading Chat...")}
          logoAtBottom
        />
      ) : (
        <>
          <View style={styles.banner}>
            <View style={styles.bannerDot} />
            <Text style={styles.bannerText}>
              {t("taxi.chat.connectedPassenger", "Connected to passenger")}
            </Text>
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.thread}
            contentContainerStyle={[
              styles.threadContent,
              messages.length === 0 ? styles.threadEmpty : null,
            ]}
            onContentSizeChange={() =>
              scrollRef.current?.scrollToEnd({ animated: true })
            }
          >
            {messages.length === 0 ? (
              <View style={styles.emptyBlock}>
                <Image
                  source={MMD_LOGO}
                  style={styles.emptyLogo}
                  resizeMode="contain"
                  accessibilityLabel="MMD Delivery"
                />
                <Text style={styles.emptyTitle}>
                  {t("taxi.chat.emptyTitle", "No Messages Yet")}
                </Text>
                <Text style={styles.emptyBody}>
                  {t(
                    "taxi.chat.emptyDriverBody",
                    "Send a message to your passenger"
                  )}
                </Text>
              </View>
            ) : (
              messages.map((msg) => {
                const mine = msg.user_id === userId;
                return (
                  <View
                    key={msg.id}
                    style={[
                      styles.row,
                      mine ? styles.rowMine : styles.rowTheirs,
                    ]}
                  >
                    <View
                      style={[
                        styles.bubble,
                        mine ? styles.bubbleMine : styles.bubbleTheirs,
                      ]}
                    >
                      <View style={styles.bubbleMeta}>
                        <Text style={styles.bubbleSender}>
                          {mine
                            ? t("shared.orderChat.sender.you", "You")
                            : t("taxi.chat.passenger", "Passenger")}
                        </Text>
                        {mine ? (
                          <Text style={styles.bubbleCheck}>✓</Text>
                        ) : null}
                      </View>
                      <Text style={styles.bubbleTime}>
                        {formatDateTime(msg.created_at, i18n.language, {
                          timeStyle: "short",
                          dateStyle: undefined,
                        })}
                      </Text>
                      {msg.text ? (
                        <Text
                          style={[
                            styles.bubbleText,
                            { textAlign: textAlignStart() },
                          ]}
                        >
                          {msg.text}
                        </Text>
                      ) : null}
                      {msg._signedUrl ? (
                        <Image
                          source={{ uri: msg._signedUrl }}
                          style={styles.bubbleImage}
                        />
                      ) : null}
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          <View style={styles.composer}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={t(
                "taxi.chat.clientPlaceholder",
                "Message passenger..."
              )}
              placeholderTextColor="rgba(255,255,255,0.4)"
              style={styles.input}
            />
            <View style={styles.actions}>
              <TouchableOpacity
                onPress={() => void sendImageMessage()}
                disabled={sending}
                style={[styles.imageBtn, sending && styles.btnDisabled]}
                activeOpacity={0.85}
              >
                <Text style={styles.imageBtnText}>
                  {t("driver.chat.actions.image", "📷 Image")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => void sendMessage()}
                disabled={sending || !text.trim()}
                style={[
                  styles.sendBtn,
                  (sending || !text.trim()) && styles.btnDisabled,
                ]}
                activeOpacity={0.85}
              >
                <Text style={styles.sendBtnText}>
                  {t("driver.chat.actions.send", "📤 Send")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {brandFooter}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  banner: {
    backgroundColor: MMD_ACTION_NAVY,
    height: 36,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  bannerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: MMD_TAXI_GREEN,
  },
  bannerText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    fontFamily: MMD_FONT.regular,
  },
  thread: { flex: 1 },
  threadContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  threadEmpty: {
    flexGrow: 1,
    justifyContent: "center",
  },
  emptyBlock: {
    alignItems: "center",
    gap: 8,
    padding: 24,
  },
  emptyLogo: {
    width: 64,
    height: 64,
    borderRadius: 14,
    marginBottom: 8,
  },
  emptyTitle: {
    color: MMD_WHITE,
    fontSize: 18,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  emptyBody: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
    textAlign: "center",
  },
  row: { width: "100%", flexDirection: "row" },
  rowMine: { justifyContent: "flex-end" },
  rowTheirs: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: 290,
    padding: 12,
    gap: 4,
  },
  bubbleMine: {
    backgroundColor: MMD_TAXI_GREEN,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 4,
  },
  bubbleTheirs: {
    backgroundColor: MMD_ACTION_NAVY,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 16,
  },
  bubbleMeta: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    width: "100%",
  },
  bubbleSender: {
    color: MMD_WHITE,
    fontSize: 11,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  bubbleCheck: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 10,
    fontFamily: MMD_FONT.regular,
  },
  bubbleTime: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 10,
    fontFamily: MMD_FONT.regular,
  },
  bubbleText: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
  },
  bubbleImage: {
    width: 180,
    height: 180,
    borderRadius: 8,
    marginTop: 4,
  },
  composer: {
    backgroundColor: MMD_ACTION_NAVY,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  input: {
    height: 40,
    borderRadius: 10,
    paddingHorizontal: 14,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    color: MMD_WHITE,
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
  },
  actions: {
    flexDirection: "row",
    gap: 8,
    height: 40,
  },
  imageBtn: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  imageBtnText: {
    color: MMD_WHITE,
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
  },
  sendBtn: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: MMD_TAXI_GREEN,
  },
  sendBtnText: {
    color: MMD_TEXT,
    fontSize: 13,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  btnDisabled: { opacity: 0.5 },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    height: 48,
    paddingHorizontal: 16,
    backgroundColor: MMD_BLUE,
  },
  footerLogo: {
    width: 40,
    height: 40,
    borderRadius: 12,
  },
  footerBrand: {
    color: MMD_GOLD_CLASSIC,
    fontSize: 14,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
});
