// apps/mobile/src/screens/_shared/OrderChatBase.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Image,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "../../lib/supabase";

type Row = {
  id: number;
  order_id: string;
  user_id: string | null;

  // ✅ compat: certains vieux rows peuvent avoir "message" au lieu de "text"
  text: string | null;
  message?: string | null;

  image_path: string | null;
  created_at: string;
  _signedUrl?: string | null;
};

function fmtDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("fr-FR");
  } catch {
    return iso;
  }
}

function safeText(r: Row) {
  const v = (r.text ?? (r as any).message ?? "") as string;
  return (v ?? "").toString();
}

function storageKeyFromImagePath(imagePath: string) {
  const s = (imagePath ?? "").toString().trim();
  if (!s) return "";
  // DB stocke souvent "chat-images/<key>"
  // On supporte aussi les anciens formats "<key>"
  return s.replace(/^chat-images\//, "");
}

function safeFileExt(fileName: string) {
  const name = (fileName ?? "").toString();
  const raw = name.split(".").pop() || "jpg";
  return raw.split("?")[0].split("#")[0].toLowerCase() || "jpg";
}

export function OrderChatBaseScreen(props: {
  orderId: string;
  onBack: () => void;
  titlePrefix?: string; // ex: "Client", "Driver", "Restaurant"
}) {
  const { orderId, onBack, titlePrefix } = props;

  const [rows, setRows] = useState<Row[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);

  const [pickedImage, setPickedImage] = useState<{ uri: string; fileName: string } | null>(null);

  const scrollRef = useRef<ScrollView | null>(null);

  const scrollToEnd = useCallback(() => {
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 80);
  }, []);

  const enrichSignedUrls = useCallback(async (data: Row[]) => {
    const enriched: Row[] = await Promise.all(
      data.map(async (r) => {
        if (!r.image_path) return r;

        const key = storageKeyFromImagePath(r.image_path);
        if (!key) return { ...r, _signedUrl: null };

        const { data: signed, error } = await supabase.storage
          .from("chat-images")
          .createSignedUrl(key, 60 * 30);

        if (error) return { ...r, _signedUrl: null };
        return { ...r, _signedUrl: signed?.signedUrl ?? null };
      })
    );
    return enriched;
  }, []);

  const load = useCallback(async () => {
    if (!orderId) return;

    try {
      setLoading(true);

      // ✅ IMPORTANT: on sélectionne text + message pour compat
      const { data, error } = await supabase
        .from("order_messages")
        .select("id, order_id, user_id, text, message, image_path, created_at")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true });

      if (error) throw error;

      const base = (data ?? []) as Row[];
      const enriched = await enrichSignedUrls(base);
      setRows(enriched);
      scrollToEnd();
    } catch (e: any) {
      console.log("load chat error:", e);
      Alert.alert("Erreur", e?.message ?? "Impossible de charger le chat.");
    } finally {
      setLoading(false);
    }
  }, [orderId, enrichSignedUrls, scrollToEnd]);

  useEffect(() => {
    void load();
    if (!orderId) return;

    const ch = supabase
      .channel(`order_messages:${orderId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_messages", filter: `order_id=eq.${orderId}` },
        () => void load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [orderId, load]);

  const pickImage = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission", "Autorise l’accès à la galerie pour envoyer une image.");
        return;
      }

      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });

      if (res.canceled) return;

      const asset = res.assets?.[0];
      if (!asset?.uri) return;

      const nameGuess = asset.fileName || `photo_${Date.now()}.jpg`;
      setPickedImage({ uri: asset.uri, fileName: nameGuess });
    } catch (e: any) {
      console.log("pickImage error:", e);
      Alert.alert("Erreur", e?.message ?? "Impossible de sélectionner l’image.");
    }
  }, []);

  const uploadPickedImage = useCallback(async () => {
    if (!pickedImage) return null;
    if (!orderId) throw new Error("orderId manquant");

    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id ?? "anon";

    const ext = safeFileExt(pickedImage.fileName);
    const key = `${orderId}/${Date.now()}_${Math.random().toString(36).slice(2)}_${uid}.${ext}`;

    const resp = await fetch(pickedImage.uri);
    if (!resp.ok) throw new Error(`Impossible de lire l’image (HTTP ${resp.status}).`);

    const blob = await resp.blob();

    const { error: upErr } = await supabase.storage.from("chat-images").upload(key, blob, {
      cacheControl: "3600",
      upsert: false,
      contentType: blob.type || "image/jpeg",
    });

    if (upErr) throw upErr;

    return `chat-images/${key}`;
  }, [pickedImage, orderId]);

  const send = useCallback(async () => {
    const t = text.trim();
    if (!t && !pickedImage) return;
    if (!orderId) return;

    try {
      setSending(true);

      let image_path: string | null = null;
      if (pickedImage) image_path = await uploadPickedImage();

      // ✅ on insère UNIQUEMENT text (pas message) pour éviter casser si la colonne message disparaît un jour
      const { error: insErr } = await supabase.from("order_messages").insert({
        order_id: orderId,
        text: t || null,
        image_path,
      } as any);

      if (insErr) throw insErr;

      setText("");
      setPickedImage(null);
      await load();
    } catch (e: any) {
      console.log("send chat error:", e);
      Alert.alert("Erreur", e?.message ?? "Impossible d’envoyer.");
    } finally {
      setSending(false);
    }
  }, [text, pickedImage, orderId, uploadPickedImage, load]);

  const del = useCallback(async (id: number, imagePath: string | null) => {
    try {
      if (imagePath) {
        const key = storageKeyFromImagePath(imagePath);
        if (key) {
          const { error: delObjErr } = await supabase.storage.from("chat-images").remove([key]);
          if (delObjErr) console.warn("Storage remove failed:", delObjErr.message);
        }
      }

      const { error: rpcErr } = await supabase.rpc("delete_order_message", { p_msg_id: id });
      if (rpcErr) throw rpcErr;

      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (e: any) {
      console.log("delete chat error:", e);
      Alert.alert("Erreur", e?.message ?? "Impossible de supprimer.");
    }
  }, []);

  const title = useMemo(() => {
    const short = orderId ? orderId.slice(0, 8) : "—";
    const prefix = titlePrefix ? `${titlePrefix} • ` : "";
    return `${prefix}Chat • #${short}`;
  }, [orderId, titlePrefix]);

  if (!orderId) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#020617", padding: 16 }}>
        <TouchableOpacity onPress={onBack}>
          <Text style={{ color: "#93C5FD", fontWeight: "900" }}>← Retour</Text>
        </TouchableOpacity>
        <Text style={{ color: "white", marginTop: 16 }}>Erreur: orderId manquant.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <TouchableOpacity onPress={onBack} style={{ paddingVertical: 8, paddingRight: 10 }}>
            <Text style={{ color: "#93C5FD", fontWeight: "900" }}>←</Text>
          </TouchableOpacity>

          <View style={{ alignItems: "center" }}>
            <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>{title}</Text>
            <Text style={{ color: "#9CA3AF", marginTop: 2, fontWeight: "800", fontSize: 12 }}>
              Messages & pièces jointes
            </Text>
          </View>

          <TouchableOpacity
            onPress={() => void load()}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 999,
              backgroundColor: "rgba(15,23,42,0.7)",
              borderWidth: 1,
              borderColor: "#1F2937",
            }}
          >
            <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>{loading ? "..." : "Rafraîchir"}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Messages */}
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        {loading ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 }}>
            <ActivityIndicator color="#fff" />
            <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>Chargement…</Text>
          </View>
        ) : null}

        <ScrollView
          ref={(r) => (scrollRef.current = r)}
          style={{
            flex: 1,
            borderRadius: 18,
            backgroundColor: "rgba(15,23,42,0.65)",
            borderWidth: 1,
            borderColor: "#1F2937",
            padding: 12,
          }}
          contentContainerStyle={{ paddingBottom: 14 }}
          onContentSizeChange={scrollToEnd}
        >
          {rows.length === 0 ? (
            <Text style={{ color: "#9CA3AF" }}>Aucun message pour le moment.</Text>
          ) : (
            rows.map((r) => {
              const txt = safeText(r);

              return (
                <View key={r.id} style={{ marginBottom: 14 }}>
                  <Text style={{ color: "#94A3B8", fontSize: 11, fontWeight: "800" }}>{fmtDateTime(r.created_at)}</Text>

                  {!!txt && (
                    <Text style={{ color: "white", marginTop: 6, lineHeight: 18, fontWeight: "700" }}>
                      {txt}
                    </Text>
                  )}

                  {!!r._signedUrl && (
                    <TouchableOpacity onPress={() => {}} style={{ marginTop: 10 }}>
                      <Image
                        source={{ uri: r._signedUrl }}
                        style={{ width: "100%", height: 220, borderRadius: 14, backgroundColor: "#0B1220" }}
                        resizeMode="cover"
                      />
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    onPress={() =>
                      Alert.alert("Supprimer", "Tu veux supprimer ce message ?", [
                        { text: "Annuler", style: "cancel" },
                        { text: "Supprimer", style: "destructive", onPress: () => void del(r.id, r.image_path) },
                      ])
                    }
                    style={{ marginTop: 8 }}
                  >
                    <Text style={{ color: "#FCA5A5", fontWeight: "900", fontSize: 12 }}>supprimer</Text>
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </ScrollView>

        {/* Composer */}
        <View
          style={{
            marginTop: 10,
            marginBottom: 14,
            borderRadius: 18,
            backgroundColor: "rgba(15,23,42,0.65)",
            borderWidth: 1,
            borderColor: "#1F2937",
            padding: 12,
          }}
        >
          {pickedImage ? (
            <View style={{ marginBottom: 10 }}>
              <Text style={{ color: "#94A3B8", fontWeight: "800", marginBottom: 8 }}>
                Image sélectionnée: {pickedImage.fileName}
              </Text>
              <Image
                source={{ uri: pickedImage.uri }}
                style={{ width: "100%", height: 160, borderRadius: 14, backgroundColor: "#0B1220" }}
                resizeMode="cover"
              />
              <TouchableOpacity onPress={() => setPickedImage(null)} style={{ marginTop: 8 }}>
                <Text style={{ color: "#FCA5A5", fontWeight: "900" }}>Retirer l’image</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Écrire un message…"
            placeholderTextColor="#64748B"
            multiline
            style={{
              minHeight: 44,
              maxHeight: 120,
              color: "white",
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderRadius: 14,
              backgroundColor: "rgba(2,6,23,0.55)",
              borderWidth: 1,
              borderColor: "#1F2937",
              fontWeight: "700",
            }}
          />

          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <TouchableOpacity
              onPress={() => void pickImage()}
              style={{
                flex: 1,
                height: 46,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(15,23,42,0.35)",
                borderWidth: 1,
                borderColor: "#1F2937",
              }}
            >
              <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>Image</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => void send()}
              disabled={sending || (text.trim() === "" && !pickedImage)}
              style={{
                flex: 1,
                height: 46,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(2,6,23,0.75)",
                borderWidth: 1,
                borderColor: "#1F2937",
                opacity: sending || (text.trim() === "" && !pickedImage) ? 0.5 : 1,
              }}
            >
              <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>{sending ? "Envoi…" : "Envoyer"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}
