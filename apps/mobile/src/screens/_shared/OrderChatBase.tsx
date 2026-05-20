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
import * as FileSystem from "expo-file-system/legacy";
import { decode } from "base64-arraybuffer";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { supabase } from "../../lib/supabase";

type ChatTargetRole = "client" | "driver" | "restaurant" | "admin" | "";

type Row = {
  id: string;
  order_id: string;
  user_id: string | null;
  text: string | null;
  image_path: string | null;
  created_at: string;
  sender_role?: ChatTargetRole | null;
  target_role?: ChatTargetRole | null;
  _signedUrl?: string | null;
};

const SIGNED_URL_TTL_SECONDS = 60 * 30;
const CHAT_BUCKET = "chat-images";
const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "heic", "heif"] as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_MESSAGE_LENGTH = 1200;

type AccessCheck = {
  userId: string;
  role: ChatTargetRole;
  canAccess: boolean;
};

function sanitizeMessageText(value: string) {
  return String(value || "").replace(/\s+$/g, "").slice(0, MAX_MESSAGE_LENGTH);
}

function canRoleChatWithTarget(currentRole: ChatTargetRole, targetRole: ChatTargetRole) {
  if (!currentRole) return false;
  if (!targetRole) return currentRole === "admin";

  if (currentRole === "admin") return true;
  if (targetRole === "admin") return true;

  if (currentRole === "restaurant") {
    return targetRole === "client" || targetRole === "driver";
  }

  if (currentRole === "client") {
    return targetRole === "restaurant" || targetRole === "driver";
  }

  if (currentRole === "driver") {
    return targetRole === "restaurant" || targetRole === "client";
  }

  return false;
}


function isValidUuid(value: unknown) {
  return UUID_RE.test(String(value ?? "").trim());
}

function fmtDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function storageKeyFromImagePath(imagePath: string) {
  const s = String(imagePath ?? "").trim();
  if (!s) return "";
  return s.replace(/^chat-images\//, "");
}

function safeFileExt(fileName: string) {
  const name = String(fileName ?? "");
  const raw = name.split(".").pop() || "jpg";
  return raw.split("?")[0].split("#")[0].toLowerCase() || "jpg";
}

function isHeicLike(pathOrName: string) {
  const s = String(pathOrName ?? "").toLowerCase();

  return (
    s.endsWith(".heic") ||
    s.endsWith(".heif") ||
    s.includes(".heic?") ||
    s.includes(".heif?")
  );
}

function contentTypeFromExt(ext: string) {
  const e = String(ext ?? "").toLowerCase();

  if (e === "png") return "image/png";
  if (e === "webp") return "image/webp";

  return "image/jpeg";
}

function isAllowedImageExt(ext: string) {
  return (ALLOWED_IMAGE_EXTENSIONS as readonly string[]).includes(
    String(ext ?? "").toLowerCase()
  );
}

function guessFileNameFromUri(uri: string) {
  try {
    const clean = String(uri ?? "").split("?")[0].split("#")[0];
    const last = clean.split("/").pop() || "";

    if (last.includes(".")) return last;
  } catch {}

  return `photo_${Date.now()}.jpg`;
}

function normalizeTargetRole(value: unknown): ChatTargetRole {
  const role = String(value ?? "").trim().toLowerCase();

  if (
    role === "client" ||
    role === "driver" ||
    role === "restaurant" ||
    role === "admin"
  ) {
    return role;
  }

  return "";
}

function normalizeRoleFromTitlePrefix(value?: string): ChatTargetRole {
  const raw = String(value ?? "").trim().toLowerCase();

  if (raw.includes("client")) return "client";
  if (raw.includes("driver") || raw.includes("chauffeur")) return "driver";
  if (raw.includes("restaurant")) return "restaurant";
  if (raw.includes("admin") || raw.includes("support")) return "admin";

  return "";
}

function isMissingColumnError(error: unknown) {
  const message = String((error as any)?.message ?? error ?? "").toLowerCase();

  return (
    message.includes("sender_role") ||
    message.includes("target_role") ||
    message.includes("column")
  );
}

function targetRoleLabel(role: ChatTargetRole, t: TFunction) {
  switch (role) {
    case "client":
      return t("shared.roles.client", "Client");
    case "driver":
      return t("shared.roles.driver", "Driver");
    case "restaurant":
      return t("shared.roles.restaurant", "Restaurant");
    case "admin":
      return t("shared.roles.admin", "MMD Support");
    default:
      return "";
  }
}

export function OrderChatBaseScreen(props: {
  orderId: string;
  targetRole?: ChatTargetRole | string;
  onBack: () => void;
  titlePrefix?: string;
}) {
  const { orderId, onBack, titlePrefix } = props;
  const { t } = useTranslation();

  const targetRole = normalizeTargetRole(props.targetRole);
  const currentRole = normalizeRoleFromTitlePrefix(titlePrefix);
  const isValidOrderId = useMemo(() => isValidUuid(orderId), [orderId]);

  const [rows, setRows] = useState<Row[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [pickedImage, setPickedImage] = useState<{ uri: string; fileName: string } | null>(
    null
  );

  const scrollRef = useRef<ScrollView | null>(null);

  const scrollToEnd = useCallback(() => {
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 80);
  }, []);


  const verifyAccess = useCallback(async (): Promise<AccessCheck> => {
    if (!isValidOrderId) {
      return { userId: "", role: "", canAccess: false };
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError) throw userError;

    const userId = userData.user?.id ?? "";

    if (!userId) {
      return { userId: "", role: "", canAccess: false };
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) {
      console.log("OrderChatBase profile role error:", profileError);
    }

    const profileRole = normalizeTargetRole((profile as any)?.role);
    const role = currentRole || profileRole;

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id,client_id,client_user_id,user_id,restaurant_id,restaurant_user_id,driver_id,status")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError) throw orderError;

    if (!order) {
      return { userId, role, canAccess: false };
    }

    const status = String((order as any)?.status || "").trim().toLowerCase();

    if (status === "canceled" || status === "delivered") {
      return { userId, role, canAccess: false };
    }

    const isClient =
      String((order as any)?.client_id || "") === userId ||
      String((order as any)?.client_user_id || "") === userId ||
      String((order as any)?.user_id || "") === userId;

    const isRestaurant =
      String((order as any)?.restaurant_id || "") === userId ||
      String((order as any)?.restaurant_user_id || "") === userId;

    const isDriver = String((order as any)?.driver_id || "") === userId;
    const isAdmin = role === "admin";

    const roleMatches =
      isAdmin ||
      (role === "client" && isClient) ||
      (role === "restaurant" && isRestaurant) ||
      (role === "driver" && isDriver);

    const targetAllowed = canRoleChatWithTarget(role, targetRole);

    return {
      userId,
      role,
      canAccess: roleMatches && targetAllowed,
    };
  }, [currentRole, isValidOrderId, orderId, targetRole]);

  const enrichSignedUrls = useCallback(async (data: Row[]) => {
    const enriched: Row[] = await Promise.all(
      data.map(async (r) => {
        if (!r.image_path) return r;

        const key = storageKeyFromImagePath(r.image_path);
        if (!key) return { ...r, _signedUrl: null };

        const { data: signed, error } = await supabase.storage
          .from(CHAT_BUCKET)
          .createSignedUrl(key, SIGNED_URL_TTL_SECONDS);

        if (error || !signed?.signedUrl) {
          console.log("createSignedUrl error:", {
            image_path: r.image_path,
            key,
            error,
          });

          return { ...r, _signedUrl: null };
        }

        return { ...r, _signedUrl: signed.signedUrl };
      })
    );

    return enriched;
  }, []);

  const load = useCallback(async () => {
    if (!orderId || !isValidOrderId) {
      setRows([]);
      return;
    }

    try {
      setLoading(true);
      setAccessDenied(false);

      const access = await verifyAccess();
      setCurrentUserId(access.userId || null);

      if (!access.canAccess) {
        setRows([]);
        setAccessDenied(true);
        return;
      }

      const selectWithRoles =
        "id, order_id, user_id, text, image_path, created_at, sender_role, target_role";
      const selectLegacy = "id, order_id, user_id, text, image_path, created_at";

      let query = supabase
        .from("order_messages")
        .select(selectWithRoles)
        .eq("order_id", orderId)
        .order("created_at", { ascending: true });

      if (targetRole) {
        query = query.or(
          `target_role.eq.${targetRole},sender_role.eq.${targetRole},target_role.is.null`
        );
      }

      const result = await query;

      let rawRows: any[] = [];
      let queryError: unknown = result.error;

      if (result.error && isMissingColumnError(result.error)) {
        const legacy = await supabase
          .from("order_messages")
          .select(selectLegacy)
          .eq("order_id", orderId)
          .order("created_at", { ascending: true });

        queryError = legacy.error;
        rawRows = (legacy.data ?? []) as any[];
      } else {
        rawRows = (result.data ?? []) as any[];
      }

      if (queryError) throw queryError;

      const normalizedRows: Row[] = rawRows.map((r) => ({
        id: String(r.id),
        order_id: String(r.order_id),
        user_id: r.user_id ?? null,
        text: r.text ?? null,
        image_path: r.image_path ?? null,
        created_at: String(r.created_at),
        sender_role: normalizeTargetRole(r.sender_role),
        target_role: normalizeTargetRole(r.target_role),
      }));

      const enriched = await enrichSignedUrls(normalizedRows);

      setRows(enriched);
      scrollToEnd();
    } catch (e: any) {
      console.log("load chat error:", e);

      Alert.alert(
        t("shared.orderChat.alerts.errorTitle", "Erreur"),
        e?.message ??
          t("shared.orderChat.alerts.loadFailed", "Impossible de charger la discussion.")
      );
    } finally {
      setLoading(false);
    }
  }, [orderId, isValidOrderId, targetRole, enrichSignedUrls, scrollToEnd, t, verifyAccess]);

  useEffect(() => {
    void load();

    if (!orderId || !isValidOrderId) return;

    const channel = supabase
      .channel(`order_messages:${orderId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_messages",
          filter: `order_id=eq.${orderId}`,
        },
        () => void load()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [orderId, isValidOrderId, load]);

  const pickImage = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!perm.granted) {
        Alert.alert(
          t("shared.orderChat.alerts.permissionTitle", "Permission requise"),
          t(
            "shared.orderChat.alerts.permissionGalleryBody",
            "Autorise l'accès à la galerie pour envoyer une image."
          )
        );
        return;
      }

      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
      });

      if (res.canceled) return;

      const asset = res.assets?.[0];
      if (!asset?.uri) return;

      setPickedImage({
        uri: asset.uri,
        fileName: asset.fileName || guessFileNameFromUri(asset.uri),
      });
    } catch (e: any) {
      console.log("pickImage error:", e);

      Alert.alert(
        t("shared.orderChat.alerts.errorTitle", "Erreur"),
        e?.message ??
          t("shared.orderChat.alerts.pickImageFailed", "Impossible de sélectionner l'image.")
      );
    }
  }, [t]);

  const uploadPickedImage = useCallback(async () => {
    if (!pickedImage) return null;

    if (!orderId || !isValidOrderId) {
      throw new Error(
        t(
          "shared.orderChat.errors.invalidOrderId",
          "Conversation invalide : cette discussion doit être liée à une vraie commande."
        )
      );
    }

    const access = await verifyAccess();

    if (!access.canAccess || !access.userId) {
      throw new Error(
        t(
          "shared.orderChat.errors.notAllowed",
          "Tu n’as pas accès à cette discussion."
        )
      );
    }

    const uid = access.userId;

    let uploadUri = pickedImage.uri;
    let ext = safeFileExt(pickedImage.fileName);

    if (!isAllowedImageExt(ext)) {
      throw new Error(
        t("shared.orderChat.errors.unsupportedImage", "Format d'image non supporté.")
      );
    }

    const isHeic = ext === "heic" || ext === "heif" || isHeicLike(uploadUri);

    if (isHeic) {
      const manipulated = await ImageManipulator.manipulateAsync(uploadUri, [], {
        compress: 0.85,
        format: ImageManipulator.SaveFormat.JPEG,
      });

      uploadUri = manipulated.uri;
      ext = "jpg";
    }

    const contentType = contentTypeFromExt(ext);
    const key = `${orderId}/${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}_${uid}.${ext}`;

    const info = await FileSystem.getInfoAsync(uploadUri);

    if (!info.exists) {
      throw new Error(
        t(
          "shared.orderChat.errors.imageNotFoundOnPhone",
          "Fichier image introuvable sur le téléphone."
        )
      );
    }

    const size = (info as any)?.size as number | undefined;

    if (!size || size <= 0) {
      throw new Error(
        t("shared.orderChat.errors.imageEmptyOnPhone", "Fichier image vide sur le téléphone.")
      );
    }

    if (size > MAX_IMAGE_SIZE_BYTES) {
      throw new Error(
        t(
          "shared.orderChat.errors.imageTooLarge",
          "L'image est trop volumineuse. Choisis une image plus légère."
        )
      );
    }

    const base64 = await FileSystem.readAsStringAsync(uploadUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    if (!base64 || base64.length < 10) {
      throw new Error(
        t("shared.orderChat.errors.base64ReadFailedEmpty", "Lecture base64 échouée.")
      );
    }

    const bytes = decode(base64);

    if (bytes.byteLength <= 0) {
      throw new Error(
        t("shared.orderChat.errors.arrayBufferZeroBytes", "Conversion image invalide.")
      );
    }

    const { error: uploadError } = await supabase.storage
      .from(CHAT_BUCKET)
      .upload(key, bytes, {
        cacheControl: "3600",
        upsert: true,
        contentType,
      });

    if (uploadError) throw uploadError;

    return `chat-images/${key}`;
  }, [pickedImage, orderId, isValidOrderId, t, verifyAccess]);

  const send = useCallback(async () => {
    if (sending) return;

    const trimmed = sanitizeMessageText(text.trim());

    if (!trimmed && !pickedImage) return;

    if (text.trim().length > MAX_MESSAGE_LENGTH) {
      Alert.alert(
        t("shared.orderChat.alerts.errorTitle", "Erreur"),
        t(
          "shared.orderChat.errors.messageTooLong",
          "Message trop long. Réduis le texte avant d’envoyer."
        )
      );
      return;
    }
    if (!orderId) return;

    if (!isValidOrderId) {
      Alert.alert(
        t("shared.orderChat.alerts.errorTitle", "Erreur"),
        t(
          "shared.orderChat.errors.invalidOrderId",
          "Conversation invalide : cette discussion doit être liée à une vraie commande."
        )
      );
      return;
    }

    try {
      setSending(true);

      const access = await verifyAccess();

      if (!access.userId) {
        throw new Error(
          t(
            "shared.orderChat.errors.notAuthenticated",
            "Tu dois être connecté pour envoyer un message."
          )
        );
      }

      if (!access.canAccess) {
        throw new Error(
          t(
            "shared.orderChat.errors.notAllowed",
            "Tu n’as pas accès à cette discussion."
          )
        );
      }

      const userId = access.userId;
      const senderRole = access.role || currentRole || null;

      const image_path = pickedImage ? await uploadPickedImage() : null;

      const messagePayload = {
        order_id: orderId,
        user_id: userId,
        text: trimmed || null,
        image_path,
        sender_role: senderRole,
        target_role: targetRole || null,
      };

      let { error } = await supabase.from("order_messages").insert(messagePayload as any);

      if (error && isMissingColumnError(error)) {
        const legacyPayload = {
          order_id: orderId,
          user_id: userId,
          text: trimmed || null,
          image_path,
        };

        const legacy = await supabase.from("order_messages").insert(legacyPayload as any);
        error = legacy.error;
      }

      if (error) throw error;

      setText("");
      setPickedImage(null);

      await load();
    } catch (e: any) {
      console.log("send chat error:", e);

      Alert.alert(
        t("shared.orderChat.alerts.errorTitle", "Erreur"),
        e?.message ??
          t("shared.orderChat.alerts.sendFailed", "Impossible d'envoyer le message.")
      );
    } finally {
      setSending(false);
    }
  }, [
    sending,
    text,
    pickedImage,
    orderId,
    isValidOrderId,
    targetRole,
    currentRole,
    verifyAccess,
    uploadPickedImage,
    load,
    t,
  ]);

  const del = useCallback(
    async (id: string, imagePath: string | null, ownerId?: string | null) => {
      if (!id) return;

      try {
        const access = await verifyAccess();

        if (!access.canAccess || !access.userId) {
          throw new Error(
            t(
              "shared.orderChat.errors.notAllowed",
              "Tu n’as pas accès à cette discussion."
            )
          );
        }

        if (ownerId && ownerId !== access.userId && access.role !== "admin") {
          throw new Error(
            t(
              "shared.orderChat.errors.deleteOwnOnly",
              "Tu peux supprimer seulement tes propres messages."
            )
          );
        }
        if (imagePath) {
          const key = storageKeyFromImagePath(imagePath);

          if (key) {
            const { error: removeError } = await supabase.storage
              .from(CHAT_BUCKET)
              .remove([key]);

            if (removeError) {
              console.warn("Storage remove failed:", removeError.message);
            }
          }
        }

        const { error } = await supabase.rpc("delete_order_message", {
          p_msg_id: id,
        });

        if (error) throw error;

        setRows((prev) => prev.filter((r) => r.id !== id));
      } catch (e: any) {
        console.log("delete chat error:", e);

        Alert.alert(
          t("shared.orderChat.alerts.errorTitle", "Erreur"),
          e?.message ??
            t("shared.orderChat.alerts.deleteFailed", "Impossible de supprimer le message.")
        );
      }
    },
    [t, verifyAccess]
  );

  const title = useMemo(() => {
    const short = orderId ? orderId.slice(0, 8) : "—";
    const prefix = titlePrefix ? `${titlePrefix} • ` : "";
    const target = targetRole ? ` → ${targetRoleLabel(targetRole, t)}` : "";

    return `${prefix}${t("shared.orderChat.header.title", "Chat")}${target} • #${short}`;
  }, [orderId, titlePrefix, targetRole, t]);

  if (!orderId || !isValidOrderId) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#020617", padding: 16 }}>
        <TouchableOpacity onPress={onBack}>
          <Text style={{ color: "#93C5FD", fontWeight: "900" }}>
            {t("shared.common.backWithArrow", "← Retour")}
          </Text>
        </TouchableOpacity>

        <Text style={{ color: "white", marginTop: 16, fontWeight: "900" }}>
          {t("shared.orderChat.errors.invalidOrderIdTitle", "Discussion indisponible")}
        </Text>

        <Text style={{ color: "#CBD5E1", marginTop: 8, lineHeight: 20, fontWeight: "700" }}>
          {t(
            "shared.orderChat.errors.invalidOrderIdUi",
            "Cette discussion doit être ouverte depuis une vraie commande. Le support général sera corrigé séparément pour ne plus envoyer orderId = support."
          )}
        </Text>
      </SafeAreaView>
    );
  }


  if (accessDenied) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#020617", padding: 16 }}>
        <TouchableOpacity onPress={onBack}>
          <Text style={{ color: "#93C5FD", fontWeight: "900" }}>
            {t("shared.common.backWithArrow", "← Retour")}
          </Text>
        </TouchableOpacity>

        <Text style={{ color: "#FCA5A5", marginTop: 16, fontWeight: "900" }}>
          {t("shared.orderChat.errors.accessDeniedTitle", "Accès refusé")}
        </Text>

        <Text style={{ color: "#CBD5E1", marginTop: 8, lineHeight: 20, fontWeight: "700" }}>
          {t(
            "shared.orderChat.errors.accessDeniedUi",
            "Tu ne peux pas ouvrir cette discussion avec ce compte ou cette commande est déjà terminée."
          )}
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <TouchableOpacity onPress={onBack} style={{ paddingVertical: 8, paddingRight: 10 }}>
            <Text style={{ color: "#93C5FD", fontWeight: "900" }}>
              {t("shared.common.backArrowOnly", "←")}
            </Text>
          </TouchableOpacity>

          <View style={{ alignItems: "center", flex: 1 }}>
            <Text style={{ color: "#E5E7EB", fontWeight: "900", textAlign: "center" }}>
              {title}
            </Text>

            <Text style={{ color: "#9CA3AF", marginTop: 2, fontWeight: "800", fontSize: 12 }}>
              {t("shared.orderChat.header.subtitle", "Messages & pièces jointes")}
            </Text>
          </View>

          <TouchableOpacity
            onPress={() => void load()}
            disabled={loading}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 999,
              backgroundColor: "rgba(15,23,42,0.7)",
              borderWidth: 1,
              borderColor: "#1F2937",
              opacity: loading ? 0.6 : 1,
            }}
          >
            <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
              {loading
                ? t("shared.common.loadingEllipsis", "...")
                : t("shared.common.refresh", "Rafraîchir")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

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
            <Text style={{ color: "#9CA3AF" }}>
              {t("shared.orderChat.empty", "Aucun message pour le moment.")}
            </Text>
          ) : (
            rows.map((r) => {
              const isHeicMessage = !!r.image_path && isHeicLike(r.image_path);

              return (
                <View key={r.id} style={{ marginBottom: 14 }}>
                  <Text style={{ color: "#94A3B8", fontSize: 11, fontWeight: "800" }}>
                    {fmtDateTime(r.created_at)}
                  </Text>

                  {!!r.text && (
                    <Text style={{ color: "white", marginTop: 6, lineHeight: 18, fontWeight: "700" }}>
                      {r.text}
                    </Text>
                  )}

                  {!!r._signedUrl && (
                    <Image
                      source={{ uri: r._signedUrl }}
                      style={{
                        width: "100%",
                        height: 220,
                        borderRadius: 14,
                        backgroundColor: "#0B1220",
                        marginTop: 10,
                      }}
                      resizeMode="cover"
                      onError={(e) => {
                        console.log("chat image render error:", {
                          image_path: r.image_path,
                          nativeEvent: e?.nativeEvent,
                          platform: Platform.OS,
                        });
                      }}
                    />
                  )}

                  {!r._signedUrl && isHeicMessage ? (
                    <View style={{ marginTop: 10 }}>
                      <Text style={{ color: "#FCA5A5", fontWeight: "900" }}>
                        {t(
                          "shared.orderChat.heic.oldMessageTitle",
                          "Image HEIC détectée — peut ne pas s'afficher."
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
                            onPress: () => void del(r.id, r.image_path, r.user_id),
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
                {t("shared.orderChat.image.selectedPrefix", "Image sélectionnée :")}{" "}
                {pickedImage.fileName}
              </Text>

              <Image
                source={{ uri: pickedImage.uri }}
                style={{
                  width: "100%",
                  height: 160,
                  borderRadius: 14,
                  backgroundColor: "#0B1220",
                }}
                resizeMode="cover"
              />

              <TouchableOpacity onPress={() => setPickedImage(null)} style={{ marginTop: 8 }}>
                <Text style={{ color: "#FCA5A5", fontWeight: "900" }}>
                  {t("shared.orderChat.image.remove", "Retirer l'image")}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t("shared.orderChat.placeholders.message", "Écrire un message...")}
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
              disabled={sending || accessDenied}
              style={{
                flex: 1,
                height: 46,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(15,23,42,0.35)",
                borderWidth: 1,
                borderColor: "#1F2937",
                opacity: sending || accessDenied ? 0.6 : 1,
              }}
            >
              <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
                {t("shared.orderChat.actions.image", "Image")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => void send()}
              disabled={sending || accessDenied || (text.trim() === "" && !pickedImage)}
              style={{
                flex: 1,
                height: 46,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(2,6,23,0.75)",
                borderWidth: 1,
                borderColor: "#1F2937",
                opacity: sending || accessDenied || (text.trim() === "" && !pickedImage) ? 0.5 : 1,
              }}
            >
              <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
                {sending
                  ? t("shared.orderChat.actions.sending", "Envoi...")
                  : t("shared.orderChat.actions.send", "Envoyer")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

export default OrderChatBaseScreen;
