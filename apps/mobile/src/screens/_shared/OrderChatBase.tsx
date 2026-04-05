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
  Platform,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy"; // ✅ FIX SDK54: use legacy API
import { decode } from "base64-arraybuffer";
import { supabase } from "../../lib/supabase";
import { useTranslation } from "react-i18next";

type Row = {
  id: string; // uuid -> string
  order_id: string;
  user_id: string | null;
  text: string | null;
  image_path: string | null; // ex: "chat-images/<orderId>/<file>.<ext>"
  created_at: string;
  _signedUrl?: string | null;
};

const SIGNED_URL_TTL_SECONDS = 60 * 30; // 30 min
const CHAT_BUCKET = "chat-images";

function fmtDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("fr-FR");
  } catch {
    return iso;
  }
}

/**
 * DB image_path stocke comme:
 *   chat-images/<orderId>/<file>
 * Supabase createSignedUrl attend la "key" DANS le bucket:
 *   <orderId>/<file>
 */
function storageKeyFromImagePath(imagePath: string) {
  const s = (imagePath ?? "").toString().trim();
  if (!s) return "";
  return s.replace(/^chat-images\//, "");
}

function safeFileExt(fileName: string) {
  const name = (fileName ?? "").toString();
  const raw = name.split(".").pop() || "jpg";
  return raw.split("?")[0].split("#")[0].toLowerCase() || "jpg";
}

function isHeicLike(pathOrName: string) {
  const s = (pathOrName ?? "").toLowerCase();
  return (
    s.endsWith(".heic") ||
    s.endsWith(".heif") ||
    s.includes(".heic?") ||
    s.includes(".heif?")
  );
}

function contentTypeFromExt(ext: string) {
  const e = (ext ?? "").toLowerCase();
  if (e === "png") return "image/png";
  if (e === "webp") return "image/webp";
  return "image/jpeg";
}

function guessFileNameFromUri(uri: string) {
  try {
    const clean = (uri ?? "").split("?")[0].split("#")[0];
    const last = clean.split("/").pop() || "";
    if (last.includes(".")) return last;
  } catch {}
  return `photo_${Date.now()}.jpg`;
}

export function OrderChatBaseScreen(props: {
  orderId: string;
  onBack: () => void;
  titlePrefix?: string; // ex: "Client", "Driver", "Restaurant"
}) {
  const { orderId, onBack, titlePrefix } = props;
  const { t } = useTranslation();

  const [rows, setRows] = useState<Row[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);

  const [pickedImage, setPickedImage] = useState<{ uri: string; fileName: string } | null>(
    null
  );

  const scrollRef = useRef<ScrollView | null>(null);

  const scrollToEnd = useCallback(() => {
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 80);
  }, []);

  // ✅ DEBUG PRO + logs createSignedUrl
  const enrichSignedUrls = useCallback(
    async (data: Row[]) => {
      const enriched: Row[] = await Promise.all(
        data.map(async (r) => {
          if (!r.image_path) return r;

          const key = storageKeyFromImagePath(r.image_path);
          if (!key) return { ...r, _signedUrl: null };

          const { data: signed, error } = await supabase.storage
            .from(CHAT_BUCKET)
            .createSignedUrl(key, SIGNED_URL_TTL_SECONDS);

          if (error) {
            console.log("⚠️ createSignedUrl error:", { image_path: r.image_path, key, error });
            return { ...r, _signedUrl: null };
          }

          if (!signed?.signedUrl) {
            console.log("⚠️ signedUrl missing:", { image_path: r.image_path, key, signed });
            return { ...r, _signedUrl: null };
          }

          if (isHeicLike(r.image_path)) {
            console.log("⚠️ HEIC detected in message image_path (may not render):", {
              image_path: r.image_path,
              key,
            });
          }

          return { ...r, _signedUrl: signed.signedUrl };
        })
      );
      return enriched;
    },
    [] // ✅ stable
  );

  const load = useCallback(async () => {
    if (!orderId) return;

    try {
      setLoading(true);

      const { data, error } = await supabase
        .from("order_messages")
        .select("id, order_id, user_id, text, image_path, created_at")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true });

      if (error) throw error;

      const base = (data ?? []) as Row[];
      const enriched = await enrichSignedUrls(base);
      setRows(enriched);
      scrollToEnd();
    } catch (e: any) {
      console.log("load chat error:", e);
      Alert.alert(
        t("shared.orderChat.alerts.errorTitle", "Erreur"),
        e?.message ?? t("shared.orderChat.alerts.loadFailed", "Impossible de charger la discussion.")
      );
    } finally {
      setLoading(false);
    }
  }, [orderId, enrichSignedUrls, scrollToEnd, t]);

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
        Alert.alert(
          t("shared.orderChat.alerts.permissionTitle", "Permission requise"),
          t(
            "shared.orderChat.alerts.permissionGalleryBody",
            "Autorise l'acces a la galerie pour envoyer une image."
          )
        );
        return;
      }

      // ✅ FIX: eviter ImagePicker.MediaType.Images (undefined selon version Expo Go)
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.85,
      });

      if (res.canceled) return;

      const asset = res.assets?.[0];
      if (!asset?.uri) return;

      const fileName = asset.fileName || guessFileNameFromUri(asset.uri);
      setPickedImage({ uri: asset.uri, fileName });
    } catch (e: any) {
      console.log("pickImage error:", e);
      Alert.alert(
        t("shared.orderChat.alerts.errorTitle", "Erreur"),
        e?.message ?? t("shared.orderChat.alerts.pickImageFailed", "Impossible de selectionner l'image.")
      );
    }
  }, [t]);

  /**
   * ✅ FIX PRO:
   * - convertit HEIC/HEIF -> JPG
   * - lit le fichier via FileSystem (base64)
   * - decode base64 -> ArrayBuffer
   * - upload ArrayBuffer
   */
  const uploadPickedImage = useCallback(async () => {
    if (!pickedImage) return null;
    if (!orderId) throw new Error(t("shared.orderChat.errors.missingOrderId", "orderId manquant"));

    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id ?? "anon";

    let uploadUri = pickedImage.uri;
    let ext = safeFileExt(pickedImage.fileName);

    const isHeic =
      ext === "heic" ||
      ext === "heif" ||
      uploadUri.toLowerCase().endsWith(".heic") ||
      uploadUri.toLowerCase().endsWith(".heif");

    if (isHeic) {
      console.log(t("shared.orderChat.debug.heicDetected", "🟡 HEIC detecte, conversion en JPG..."), {
        uploadUri,
        ext,
      });

      const manipulated = await ImageManipulator.manipulateAsync(uploadUri, [], {
        compress: 0.85,
        format: ImageManipulator.SaveFormat.JPEG,
      });

      uploadUri = manipulated.uri;
      ext = "jpg";
    }

    const contentType = contentTypeFromExt(ext);
    const key = `${orderId}/${Date.now()}_${Math.random().toString(36).slice(2)}_${uid}.${ext}`;

    // ✅ Type narrowing: FileInfo est une union => size dispo seulement si exists:true
    const info = await FileSystem.getInfoAsync(uploadUri);

    if (!info.exists) {
      console.log("📦 local file info:", { exists: false, uri: uploadUri, ext, contentType, key });
      throw new Error(
        t("shared.orderChat.errors.imageNotFoundOnPhone", "Fichier image introuvable sur le telephone.")
      );
    }

    // ici TS sait que exists === true, donc size peut exister selon la version runtime
    const size = (info as any)?.size as number | undefined;

    console.log("📦 local file info:", {
      exists: true,
      size,
      uri: uploadUri,
      ext,
      contentType,
      key,
    });

    if (!size || size <= 0) {
      throw new Error(
        t("shared.orderChat.errors.imageEmptyOnPhone", "Fichier image vide (0 bytes) sur le telephone.")
      );
    }

    const base64 = await FileSystem.readAsStringAsync(uploadUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    if (!base64 || base64.length < 10) {
      throw new Error(t("shared.orderChat.errors.base64ReadFailedEmpty", "Lecture base64 echouee (vide)."));
    }

    const bytes = decode(base64);

    console.log("📤 chat upload bytes:", {
      bytes: bytes.byteLength,
      key,
      contentType,
    });

    if (bytes.byteLength <= 0) {
      throw new Error(
        t("shared.orderChat.errors.arrayBufferZeroBytes", "Conversion ArrayBuffer a produit 0 bytes.")
      );
    }

    const { error: upErr } = await supabase.storage.from(CHAT_BUCKET).upload(key, bytes, {
      cacheControl: "3600",
      upsert: true,
      contentType,
    });

    if (upErr) {
      console.log("❌ storage upload error:", { key, contentType, upErr });
      throw upErr;
    }

    return `chat-images/${key}`;
  }, [pickedImage, orderId, t]);

  const send = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed && !pickedImage) return;
    if (!orderId) return;

    try {
      setSending(true);

      let image_path: string | null = null;
      if (pickedImage) image_path = await uploadPickedImage();

      const { error: insErr } = await supabase.from("order_messages").insert({
        order_id: orderId,
        text: trimmed || null,
        image_path,
      } as any);

      if (insErr) throw insErr;

      setText("");
      setPickedImage(null);
      await load();
    } catch (e: any) {
      console.log("send chat error:", e);
      Alert.alert(
        t("shared.orderChat.alerts.errorTitle", "Erreur"),
        e?.message ?? t("shared.orderChat.alerts.sendFailed", "Impossible d'envoyer le message.")
      );
    } finally {
      setSending(false);
    }
  }, [text, pickedImage, orderId, uploadPickedImage, load, t]);

  const del = useCallback(
    async (id: string, imagePath: string | null) => {
      try {
        if (imagePath) {
          const key = storageKeyFromImagePath(imagePath);
          if (key) {
            const { error: delObjErr } = await supabase.storage.from(CHAT_BUCKET).remove([key]);
            if (delObjErr) console.warn("Storage remove failed:", delObjErr.message);
          }
        }

        const { error: rpcErr } = await supabase.rpc("delete_order_message", { p_msg_id: id });
        if (rpcErr) throw rpcErr;

        setRows((prev) => prev.filter((r) => r.id !== id));
      } catch (e: any) {
        console.log("delete chat error:", e);
        Alert.alert(
          t("shared.orderChat.alerts.errorTitle", "Erreur"),
          e?.message ?? t("shared.orderChat.alerts.deleteFailed", "Impossible de supprimer le message.")
        );
      }
    },
    [t]
  );

  const title = useMemo(() => {
    const short = orderId ? orderId.slice(0, 8) : "—";
    const prefix = titlePrefix ? `${titlePrefix} • ` : "";
    return `${prefix}Chat • #${short}`;
  }, [orderId, titlePrefix]);

  if (!orderId) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#020617", padding: 16 }}>
        <TouchableOpacity onPress={onBack}>
          <Text style={{ color: "#93C5FD", fontWeight: "900" }}>
            {t("shared.common.backWithArrow", "← Retour")}
          </Text>
        </TouchableOpacity>
        <Text style={{ color: "white", marginTop: 16 }}>
          {t("shared.orderChat.errors.missingOrderIdUi", "Erreur: orderId manquant.")}
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <TouchableOpacity onPress={onBack} style={{ paddingVertical: 8, paddingRight: 10 }}>
            <Text style={{ color: "#93C5FD", fontWeight: "900" }}>
              {t("shared.common.backArrowOnly", "←")}
            </Text>
          </TouchableOpacity>

          <View style={{ alignItems: "center" }}>
            <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>{title}</Text>
            <Text style={{ color: "#9CA3AF", marginTop: 2, fontWeight: "800", fontSize: 12 }}>
              {t("shared.orderChat.header.subtitle", "Messages & pieces jointes")}
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
            <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
              {loading ? t("shared.common.loadingEllipsis", "...") : t("shared.common.refresh", "Rafraichir")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Messages */}
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        {loading ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 }}>
            <ActivityIndicator color="#fff" />
            <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>
              {t("shared.common.loading", "Chargement...")}
            </Text>
          </View>
        ) : null}

        <ScrollView
          // ✅ FIX React 19 types: callback ref must return void
          ref={(r) => {
            scrollRef.current = r;
          }}
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
            <Text style={{ color: "#9CA3AF" }}>{t("shared.orderChat.empty", "Aucun message pour le moment.")}</Text>
          ) : (
            rows.map((r) => {
              const isHeicMessage = !!r.image_path && isHeicLike(r.image_path);

              return (
                <View key={r.id} style={{ marginBottom: 14 }}>
                  <Text style={{ color: "#94A3B8", fontSize: 11, fontWeight: "800" }}>{fmtDateTime(r.created_at)}</Text>

                  {!!r.text && (
                    <Text style={{ color: "white", marginTop: 6, lineHeight: 18, fontWeight: "700" }}>
                      {r.text}
                    </Text>
                  )}

                  {!!r._signedUrl && (
                    <TouchableOpacity onPress={() => {}} style={{ marginTop: 10 }}>
                      <Image
                        source={{ uri: r._signedUrl }}
                        style={{ width: "100%", height: 220, borderRadius: 14, backgroundColor: "#0B1220" }}
                        resizeMode="cover"
                        onError={(e) => {
                          console.log("⚠️ chat image render error:", {
                            image_path: r.image_path,
                            signedUrl: r._signedUrl,
                            nativeEvent: e?.nativeEvent,
                            platform: Platform.OS,
                          });
                        }}
                      />
                    </TouchableOpacity>
                  )}

                  {!r._signedUrl && isHeicMessage ? (
                    <View style={{ marginTop: 10 }}>
                      <Text style={{ color: "#FCA5A5", fontWeight: "900" }}>
                        {t(
                          "shared.orderChat.heic.oldMessageTitle",
                          "Image HEIC detectee (ancien message) — peut ne pas s'afficher sur l'app."
                        )}
                      </Text>
                      <Text style={{ color: "#94A3B8", marginTop: 6, fontWeight: "700", fontSize: 12 }}>
                        {t(
                          "shared.orderChat.heic.oldMessageBody",
                          "Solution: renvoyer l'image apres la mise a jour (HEIC -> JPG). Pour l'ancienne, il faut conversion/migration."
                        )}
                      </Text>
                    </View>
                  ) : null}

                  <TouchableOpacity
                    onPress={() =>
                      Alert.alert(
                        t("shared.orderChat.actions.deleteTitle", "Supprimer"),
                        t("shared.orderChat.actions.deleteConfirm", "Tu veux supprimer ce message ?"),
                        [
                          { text: t("shared.common.cancel", "Annuler"), style: "cancel" },
                          {
                            text: t("shared.common.delete", "Supprimer"),
                            style: "destructive",
                            onPress: () => void del(r.id, r.image_path),
                          },
                        ]
                      )
                    }
                    style={{ marginTop: 8 }}
                  >
                    <Text style={{ color: "#FCA5A5", fontWeight: "900", fontSize: 12 }}>
                      {t("shared.orderChat.actions.deleteLower", "supprimer")}
                    </Text>
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
                {t("shared.orderChat.image.selectedPrefix", "Image selectionnee :")} {pickedImage.fileName}
              </Text>
              <Image
                source={{ uri: pickedImage.uri }}
                style={{ width: "100%", height: 160, borderRadius: 14, backgroundColor: "#0B1220" }}
                resizeMode="cover"
              />
              <TouchableOpacity onPress={() => setPickedImage(null)} style={{ marginTop: 8 }}>
                <Text style={{ color: "#FCA5A5", fontWeight: "900" }}>{t("shared.orderChat.image.remove", "Retirer l'image")}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t("shared.orderChat.placeholders.message", "Ecrire un message...")}
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
              <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>{t("shared.orderChat.actions.image", "Image")}</Text>
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
              <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
                {sending ? t("shared.orderChat.actions.sending", "Envoi...") : t("shared.orderChat.actions.send", "Envoyer")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}