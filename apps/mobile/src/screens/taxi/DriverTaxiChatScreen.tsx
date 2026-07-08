import React, { useCallback, useEffect, useRef, useState } from "react";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { decode } from "base64-arraybuffer";
import * as FileSystem from "expo-file-system/legacy";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import { supabase } from "../../lib/supabase";
import {
  subscribePostgresChannel,
  unsubscribeSupabaseChannel,
} from "../../lib/supabaseRealtime";
import { rowDirection, textAlignStart } from "../../i18n/rtl";
import ScreenHeader from "../../components/navigation/ScreenHeader";

type Nav = NativeStackNavigationProp<RootStackParamList, "DriverTaxiChat">;
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

export default function DriverTaxiChatScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<ChatRoute>();
  const { t } = useTranslation();
  const rideId = route.params.rideId;
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" />
      <ScreenHeader
        title={t("taxi.chat.title", "Taxi chat")}
        fallbackRoute="DriverTabs"
        variant="dark"
      />
      {loading ? (
        <ActivityIndicator color="#F59E0B" />
      ) : (
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1, paddingHorizontal: 12 }}
          onContentSizeChange={() =>
            scrollRef.current?.scrollToEnd({ animated: true })
          }
        >
          {messages.map((msg) => {
            const mine = msg.user_id === userId;
            return (
              <View
                key={msg.id}
                style={{
                  alignSelf: mine ? "flex-end" : "flex-start",
                  backgroundColor: mine ? "#15803D" : "#1E293B",
                  padding: 10,
                  borderRadius: 12,
                  marginBottom: 8,
                  maxWidth: "82%",
                }}
              >
                {msg.text ? (
                  <Text style={{ color: "#F8FAFC" }}>{msg.text}</Text>
                ) : null}
                {msg._signedUrl ? (
                  <Image
                    source={{ uri: msg._signedUrl }}
                    style={{ width: 180, height: 180, borderRadius: 8 }}
                  />
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      )}
      <View style={{ flexDirection: rowDirection(), gap: 8, padding: 12 }}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t("taxi.chat.clientPlaceholder", "Message client…")}
          placeholderTextColor="#64748B"
          style={{
            flex: 1,
            backgroundColor: "#111827",
            color: "#fff",
            borderRadius: 12,
            paddingHorizontal: 12,
          }}
        />
        <TouchableOpacity onPress={sendMessage} disabled={sending}>
          <Text style={{ color: "#F59E0B", fontWeight: "800" }}>
            {t("taxi.common.send", "Send")}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
