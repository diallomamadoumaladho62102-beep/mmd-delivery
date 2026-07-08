// apps/mobile/src/screens/_shared/OrderChatBase.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
import { SafeAreaView } from "react-native-safe-area-context";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy";
import { decode } from "base64-arraybuffer";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { supabase } from "../../lib/supabase";
import {
  subscribePostgresChannel,
  unsubscribeSupabaseChannel,
} from "../../lib/supabaseRealtime";
import { mmdAudio } from "../../lib/mmdAudio";

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

type ChatParticipant = {
  id: string;
  role: ChatTargetRole;
  name: string;
  avatarUrl: string | null;
};

type BasicProfile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
};

type RestaurantProfile = {
  id?: string | null;
  user_id?: string | null;
  restaurant_name?: string | null;
  business_name?: string | null;
  avatar_url?: string | null;
  logo_url?: string | null;
};

const SIGNED_URL_TTL_SECONDS = 60 * 30;
const CHAT_BUCKET = "chat-images";
const AVATARS_BUCKET = "avatars";
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

function isHttpUrl(value: string | null | undefined) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function resolveStorageUrl(bucket: string, value: string | null | undefined) {
  const clean = String(value || "").trim();
  if (!clean) return null;
  if (isHttpUrl(clean)) return clean;

  const { data } = supabase.storage.from(bucket).getPublicUrl(clean);
  return data?.publicUrl || null;
}

function resolveAvatarUrl(value: string | null | undefined) {
  return resolveStorageUrl(AVATARS_BUCKET, value);
}

function initials(name: string) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase() || "??";
}

function participantFallbackEmoji(role: ChatTargetRole) {
  if (role === "client") return "👤";
  if (role === "driver") return "🚚";
  if (role === "restaurant") return "🍽️";
  if (role === "admin") return "🛟";
  return "💬";
}

function displayNameFromProfile(profile: BasicProfile | null, fallback: string, id?: string | null) {
  const name = profile?.full_name?.trim();
  if (name) return name;
  const cleanId = String(id || "").trim();
  if (cleanId) return `${fallback} ${cleanId.slice(0, 8)}`;
  return fallback;
}

function displayNameFromRestaurant(profile: RestaurantProfile | null, fallback: string) {
  return (
    profile?.restaurant_name?.trim() ||
    profile?.business_name?.trim() ||
    fallback
  );
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
  const [participants, setParticipants] = useState<Record<string, ChatParticipant>>({});
  const [accessDenied, setAccessDenied] = useState(false);
  const [pickedImage, setPickedImage] = useState<{ uri: string; fileName: string } | null>(
    null
  );

  const scrollRef = useRef<ScrollView | null>(null);
  const currentUserIdRef = useRef<string | null>(null);

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


  const loadParticipants = useCallback(
    async (currentAccess?: AccessCheck) => {
      if (!isValidOrderId) {
        setParticipants({});
        return;
      }

      try {
        const { data: order, error } = await supabase
          .from("orders")
          .select("client_id,client_user_id,user_id,restaurant_id,restaurant_user_id,driver_id,restaurant_name")
          .eq("id", orderId)
          .maybeSingle();

        if (error) throw error;

        if (!order) {
          setParticipants({});
          return;
        }

        const clientId =
          String((order as any)?.client_user_id || "").trim() ||
          String((order as any)?.client_id || "").trim() ||
          String((order as any)?.user_id || "").trim();

        const driverId = String((order as any)?.driver_id || "").trim();
        const restaurantUserId = String((order as any)?.restaurant_user_id || "").trim();
        const restaurantId = String((order as any)?.restaurant_id || "").trim();
        const restaurantFallbackName = String((order as any)?.restaurant_name || "").trim();

        const next: Record<string, ChatParticipant> = {};

        const fetchProfile = async (id: string, role: ChatTargetRole, fallback: string) => {
          if (!id) return;

          try {
            const { data } = await supabase
              .from("profiles")
              .select("id, full_name, avatar_url")
              .eq("id", id)
              .maybeSingle();

            const profile = (data as BasicProfile | null) ?? null;
            next[id] = {
              id,
              role,
              name: displayNameFromProfile(profile, fallback, id),
              avatarUrl: resolveAvatarUrl(profile?.avatar_url),
            };
          } catch {
            next[id] = {
              id,
              role,
              name: `${fallback} ${id.slice(0, 8)}`,
              avatarUrl: null,
            };
          }
        };

        await fetchProfile(clientId, "client", targetRoleLabel("client", t));
        await fetchProfile(driverId, "driver", targetRoleLabel("driver", t));

        if (restaurantUserId || restaurantId) {
          try {
            let restaurantProfile: RestaurantProfile | null = null;

            if (restaurantUserId) {
              const { data } = await supabase
                .from("restaurant_profiles")
                .select("id, user_id, restaurant_name, business_name, avatar_url, logo_url")
                .eq("user_id", restaurantUserId)
                .maybeSingle();

              restaurantProfile = (data as RestaurantProfile | null) ?? null;
            }

            if (!restaurantProfile && restaurantId) {
              const { data } = await supabase
                .from("restaurant_profiles")
                .select("id, user_id, restaurant_name, business_name, avatar_url, logo_url")
                .eq("id", restaurantId)
                .maybeSingle();

              restaurantProfile = (data as RestaurantProfile | null) ?? null;
            }

            const restaurantKey = restaurantUserId || restaurantId;
            next[restaurantKey] = {
              id: restaurantKey,
              role: "restaurant",
              name: displayNameFromRestaurant(
                restaurantProfile,
                restaurantFallbackName || targetRoleLabel("restaurant", t)
              ),
              avatarUrl:
                resolveAvatarUrl(restaurantProfile?.avatar_url) ||
                resolveAvatarUrl(restaurantProfile?.logo_url),
            };
          } catch {
            const restaurantKey = restaurantUserId || restaurantId;
            next[restaurantKey] = {
              id: restaurantKey,
              role: "restaurant",
              name: restaurantFallbackName || targetRoleLabel("restaurant", t),
              avatarUrl: null,
            };
          }
        }

        const supportId = "admin";
        next[supportId] = {
          id: supportId,
          role: "admin",
          name: targetRoleLabel("admin", t),
          avatarUrl: null,
        };

        if (currentAccess?.userId && currentAccess.role && !next[currentAccess.userId]) {
          next[currentAccess.userId] = {
            id: currentAccess.userId,
            role: currentAccess.role,
            name: targetRoleLabel(currentAccess.role, t),
            avatarUrl: null,
          };
        }

        setParticipants(next);
      } catch (e) {
        console.log("load chat participants error:", e);
        setParticipants({});
      }
    },
    [isValidOrderId, orderId, t]
  );

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
      currentUserIdRef.current = access.userId || null;

      if (!access.canAccess) {
        setRows([]);
        setAccessDenied(true);
        return;
      }

      await loadParticipants(access);

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
  }, [orderId, isValidOrderId, targetRole, enrichSignedUrls, scrollToEnd, t, verifyAccess, loadParticipants]);

  useEffect(() => {
    void load();

    if (!orderId || !isValidOrderId) return;

    const channel = subscribePostgresChannel(`order_messages:${orderId}`, [
      {
        event: "INSERT",
        table: "order_messages",
        filter: `order_id=eq.${orderId}`,
        callback: (payload) => {
          const row = (payload as { new?: { user_id?: string | null } }).new;
          if (row?.user_id && row.user_id !== currentUserIdRef.current) {
            void mmdAudio.play("chat");
          }
          void load();
        },
      },
      {
        event: "UPDATE",
        table: "order_messages",
        filter: `order_id=eq.${orderId}`,
        callback: () => void load(),
      },
      {
        event: "DELETE",
        table: "order_messages",
        filter: `order_id=eq.${orderId}`,
        callback: () => void load(),
      },
    ]);

    return () => {
      void unsubscribeSupabaseChannel(channel);
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


  const getParticipant = useCallback(
    (row: Row) => {
      const userId = String(row.user_id || "").trim();

      if (userId && participants[userId]) {
        return participants[userId];
      }

      const role = normalizeTargetRole(row.sender_role) || "";
      const fallbackName = role ? targetRoleLabel(role, t) : t("shared.orderChat.sender.unknown", "Participant");

      return {
        id: userId || role || "unknown",
        role,
        name: fallbackName,
        avatarUrl: null,
      } as ChatParticipant;
    },
    [participants, t]
  );

  const title = useMemo(() => {
    const short = orderId ? orderId.slice(0, 8) : "—";
    const prefix = titlePrefix ? `${titlePrefix} • ` : "";
    const target = targetRole ? ` → ${targetRoleLabel(targetRole, t)}` : "";

    return `${prefix}${t("shared.orderChat.header.title", "Chat")}${target} • #${short}`;
  }, [orderId, titlePrefix, targetRole, t]);

  if (!orderId || !isValidOrderId) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }} edges={["bottom", "left", "right"]}>
        <ScreenHeader title={title} onBack={onBack} variant="dark" />

        <View style={{ paddingHorizontal: 16 }}>
        <Text style={{ color: "white", marginTop: 16, fontWeight: "900" }}>
          {t("shared.orderChat.errors.invalidOrderIdTitle", "Discussion indisponible")}
        </Text>

        <Text style={{ color: "#CBD5E1", marginTop: 8, lineHeight: 20, fontWeight: "700" }}>
          {t(
            "shared.orderChat.errors.invalidOrderIdUi",
            "Cette discussion doit être ouverte depuis une vraie commande. Le support général sera corrigé séparément pour ne plus envoyer orderId = support."
          )}
        </Text>
        </View>
      </SafeAreaView>
    );
  }


  if (accessDenied) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }} edges={["bottom", "left", "right"]}>
        <ScreenHeader title={title} onBack={onBack} variant="dark" />

        <View style={{ paddingHorizontal: 16 }}>
        <Text style={{ color: "#FCA5A5", marginTop: 16, fontWeight: "900" }}>
          {t("shared.orderChat.errors.accessDeniedTitle", "Accès refusé")}
        </Text>

        <Text style={{ color: "#CBD5E1", marginTop: 8, lineHeight: 20, fontWeight: "700" }}>
          {t(
            "shared.orderChat.errors.accessDeniedUi",
            "Tu ne peux pas ouvrir cette discussion avec ce compte ou cette commande est déjà terminée."
          )}
        </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={title}
        subtitle={t("shared.orderChat.header.subtitle", "Messages & pièces jointes")}
        onBack={onBack}
        variant="dark"
        rightSlot={
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
        }
      />

      {targetRole ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 6 }}>
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{ color: "#64748B", fontWeight: "800", fontSize: 11 }}
          >
            {t("shared.orderChat.header.privateWith", "Conversation avec")}{" "}
            {targetRoleLabel(targetRole, t)}
          </Text>
        </View>
      ) : null}

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
              const isMine = !!currentUserId && r.user_id === currentUserId;
              const participant = getParticipant(r);
              const roleLabel = participant.role ? targetRoleLabel(participant.role, t) : "";
              const canDelete = isMine || currentRole === "admin";

              return (
                <View
                  key={r.id}
                  style={{
                    marginBottom: 14,
                    flexDirection: "row",
                    justifyContent: isMine ? "flex-end" : "flex-start",
                  }}
                >
                  {!isMine ? (
                    participant.avatarUrl ? (
                      <Image
                        source={{ uri: participant.avatarUrl }}
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 18,
                          marginRight: 8,
                          backgroundColor: "#0B1220",
                          borderWidth: 1,
                          borderColor: "rgba(148,163,184,0.22)",
                        }}
                      />
                    ) : (
                      <View
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 18,
                          marginRight: 8,
                          backgroundColor: "#0B1220",
                          borderWidth: 1,
                          borderColor: "rgba(148,163,184,0.22)",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Text style={{ fontSize: 14 }}>{participantFallbackEmoji(participant.role)}</Text>
                      </View>
                    )
                  ) : null}

                  <View
                    style={{
                      maxWidth: "82%",
                      minWidth: 120,
                      borderRadius: 16,
                      padding: 10,
                      backgroundColor: isMine ? "rgba(37,99,235,0.32)" : "rgba(2,6,23,0.56)",
                      borderWidth: 1,
                      borderColor: isMine ? "rgba(96,165,250,0.32)" : "rgba(148,163,184,0.16)",
                    }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text
                          numberOfLines={1}
                          ellipsizeMode="tail"
                          style={{ color: "#E5E7EB", fontSize: 12, fontWeight: "900" }}
                        >
                          {isMine
                            ? t("shared.orderChat.sender.you", "You")
                            : participant.name}
                        </Text>

                        <Text
                          numberOfLines={1}
                          ellipsizeMode="tail"
                          style={{ color: "#94A3B8", fontSize: 10, fontWeight: "800", marginTop: 1 }}
                        >
                          {roleLabel ? `${roleLabel} • ` : ""}
                          {fmtDateTime(r.created_at)}
                        </Text>
                      </View>

                      {isMine ? (
                        participant.avatarUrl ? (
                          <Image
                            source={{ uri: participant.avatarUrl }}
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: 14,
                              backgroundColor: "#0B1220",
                              borderWidth: 1,
                              borderColor: "rgba(148,163,184,0.22)",
                            }}
                          />
                        ) : (
                          <View
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: 14,
                              backgroundColor: "#0B1220",
                              borderWidth: 1,
                              borderColor: "rgba(148,163,184,0.22)",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Text style={{ color: "#E5E7EB", fontSize: 10, fontWeight: "900" }}>
                              {initials(participant.name)}
                            </Text>
                          </View>
                        )
                      ) : null}
                    </View>

                    {!!r.text && (
                      <Text style={{ color: "white", marginTop: 8, lineHeight: 19, fontWeight: "700" }}>
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

                    {canDelete ? (
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
                        style={{ marginTop: 8, alignSelf: isMine ? "flex-end" : "flex-start" }}
                      >
                        <Text style={{ color: "#FCA5A5", fontWeight: "900", fontSize: 12 }}>
                          {t("shared.orderChat.actions.deleteLower", "supprimer")}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
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
