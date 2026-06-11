import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  SafeAreaView,
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
import * as ImagePicker from "expo-image-picker";
import { decode } from "base64-arraybuffer";
import * as FileSystem from "expo-file-system/legacy";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import { supabase } from "../../lib/supabase";
import { formatDateTime } from "../../i18n/formatters";
import { rowDirection, textAlignStart } from "../../i18n/rtl";

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiChat">;
type ChatRoute = RouteProp<RootStackParamList, "TaxiChat">;

type TaxiMessage = {
  id: string;
  taxi_ride_id: string;
  user_id: string;
  sender_role: string | null;
  text: string | null;
  image_path: string | null;
  created_at: string;
  _signedUrl?: string | null;
};

const TAXI_IMAGES_BUCKET = "taxi-images";

export default function TaxiChatScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<ChatRoute>();
  const { t, i18n } = useTranslation();
  const rideId = route.params.rideId;
  const scrollRef = useRef<ScrollView | null>(null);

  const [messages, setMessages] = useState<TaxiMessage[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const uid = sessionData.session?.user?.id ?? null;
    setUserId(uid);

    const { data, error } = await supabase
      .from("taxi_messages")
      .select("id,taxi_ride_id,user_id,sender_role,text,image_path,created_at")
      .eq("taxi_ride_id", rideId)
      .order("created_at", { ascending: true });

    if (error) {
      console.log("[TaxiChat] load error", error.message);
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

    const channel = supabase
      .channel(`taxi_messages:${rideId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "taxi_messages",
          filter: `taxi_ride_id=eq.${rideId}`,
        },
        () => void load()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, rideId]);

  async function sendTextMessage() {
    const body = text.trim();
    if (!body || !userId) return;

    setSending(true);
    try {
      const { error } = await supabase.from("taxi_messages").insert({
        taxi_ride_id: rideId,
        user_id: userId,
        sender_role: "client",
        target_role: "driver",
        text: body,
      });

      if (error) throw error;
      setText("");
      await load();
    } catch (e: unknown) {
      Alert.alert(
        t("taxi.chat.sendFailed", "Send failed"),
        e instanceof Error ? e.message : t("taxi.chat.send", "Error")
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
        sender_role: "client",
        target_role: "driver",
        image_path: path,
      });

      if (error) throw error;
      await load();
    } catch (e: unknown) {
      Alert.alert(
        t("taxi.chat.imageFailed", "Image failed"),
        e instanceof Error ? e.message : t("taxi.chat.send", "Error")
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }}>
      <StatusBar barStyle="light-content" />
      <View style={{ padding: 12, flexDirection: rowDirection(), alignItems: "center" }}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ color: "#93C5FD" }}>{t("taxi.common.back", "← Back")}</Text>
        </TouchableOpacity>
        <Text style={{ color: "#fff", fontWeight: "800", marginLeft: 12, textAlign: textAlignStart() }}>
          {t("taxi.chat.title", "Taxi chat")}
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator color="#F59E0B" style={{ marginTop: 20 }} />
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
                  backgroundColor: mine ? "#1D4ED8" : "#1E293B",
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
                    style={{ width: 180, height: 180, borderRadius: 8, marginTop: 4 }}
                  />
                ) : null}
                <Text style={{ color: "#94A3B8", fontSize: 10, marginTop: 4 }}>
                  {formatDateTime(msg.created_at, i18n.language, {
                    timeStyle: "short",
                    dateStyle: undefined,
                  })}
                </Text>
              </View>
            );
          })}
        </ScrollView>
      )}

      <View
        style={{
          flexDirection: rowDirection(),
          gap: 8,
          padding: 12,
          borderTopWidth: 1,
          borderTopColor: "#334155",
        }}
      >
        <TouchableOpacity onPress={sendImageMessage} disabled={sending}>
          <Text style={{ color: "#93C5FD", fontSize: 22 }}>📷</Text>
        </TouchableOpacity>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t("taxi.chat.driverPlaceholder", "Message driver…")}
          placeholderTextColor="#64748B"
          style={{
            flex: 1,
            backgroundColor: "#111827",
            color: "#F8FAFC",
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 10,
          }}
        />
        <TouchableOpacity onPress={sendTextMessage} disabled={sending || !text.trim()}>
          <Text style={{ color: "#F59E0B", fontWeight: "800", fontSize: 16 }}>
            {t("taxi.common.send", "Send")}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
