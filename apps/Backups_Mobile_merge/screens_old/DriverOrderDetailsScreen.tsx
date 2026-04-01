import React, { useEffect, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StatusBar,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { supabase } from "../lib/supabase";

type DriverOrderDetailsRoute = RouteProp<
  RootStackParamList,
  "DriverOrderDetails"
>;

type Nav = NativeStackNavigationProp<
  RootStackParamList,
  "DriverOrderDetails"
>;

type OrderStatus =
  | "pending"
  | "accepted"
  | "prepared"
  | "ready"
  | "dispatched"
  | "delivered"
  | "canceled";

type Order = {
  id: string;
  status: OrderStatus;
  created_at: string | null;
  restaurant_name: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  distance_miles: number | null;
  eta_minutes: number | null;
  driver_delivery_payout: number | null;
  driver_id: string | null;
};

type VerifyKind = "pickup" | "dropoff";

export function DriverOrderDetailsScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<DriverOrderDetailsRoute>();
  const { orderId } = route.params;

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [verifyingKind, setVerifyingKind] = useState<VerifyKind | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [submittingCode, setSubmittingCode] = useState(false);

  async function fetchOrder() {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from("orders")
        .select(
          `
          id,
          status,
          created_at,
          restaurant_name,
          pickup_address,
          dropoff_address,
          distance_miles,
          eta_minutes,
          driver_delivery_payout,
          driver_id
        `
        )
        .eq("id", orderId)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        Alert.alert("Erreur", "Commande introuvable.");
        navigation.goBack();
        return;
      }

      setOrder(data as Order);
    } catch (e: any) {
      console.error("Erreur fetch driver order details:", e);
      Alert.alert(
        "Erreur",
        e?.message ?? "Impossible de charger les détails de la commande."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchOrder();
  }, [orderId]);

  function formatDate(iso: string | null) {
    if (!iso) return "—";
    const d = new Date(iso);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }

  function formatStatusLabel(status: OrderStatus) {
    switch (status) {
      case "pending":
        return "En attente d’un chauffeur";
      case "accepted":
      case "prepared":
        return "En attente (restaurant)";
      case "ready":
        return "Prête pour pickup";
      case "dispatched":
        return "En livraison";
      case "delivered":
        return "Livrée";
      case "canceled":
        return "Annulée";
      default:
        return status;
    }
  }

  // 🔐 Conditions d’activation des boutons
  const canPickup = order?.status === "ready";
  const canDeliver = order?.status === "dispatched";
  const canAccept = !!order && order.status === "pending" && !order.driver_id;

  function openCodeModal(kind: VerifyKind) {
    if (kind === "pickup" && !canPickup) return;
    if (kind === "dropoff" && !canDeliver) return;

    setCodeInput("");
    setVerifyingKind(kind);
  }

  function closeCodeModal() {
    setVerifyingKind(null);
    setCodeInput("");
    setSubmittingCode(false);
  }

  // 👉 Accepter la course → écrit driver_id + status dans "orders"
  async function handleAccept() {
    if (!order) return;
    try {
      setAccepting(true);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        console.error("Impossible d'obtenir le user", userError);
        Alert.alert(
          "Erreur",
          "Impossible de récupérer ton profil chauffeur. Reconnecte-toi."
        );
        return;
      }

      console.log("📦 Acceptation commande pour chauffeur :", user.id);

      const { error: updateError } = await supabase
        .from("orders")
        .update({
          driver_id: user.id,
          status: "accepted",
        })
        .eq("id", order.id)
        .is("driver_id", null);

      if (updateError) {
        console.error("❌ Erreur update orders:", updateError);
        Alert.alert(
          "Erreur",
          updateError.message ?? "Impossible d'accepter cette course."
        );
        return;
      }

      const { error: joinError } = await supabase.rpc("join_order", {
        p_order_id: order.id,
        p_role: "driver",
      });

      if (joinError) {
        console.error("⚠️ Erreur join_order:", joinError);
      }

      await fetchOrder();
      Alert.alert("Course acceptée ✅", "Tu es maintenant assigné à cette course.");
    } catch (e: any) {
      console.error("Erreur handleAccept:", e);
      Alert.alert(
        "Erreur",
        e?.message ?? "Impossible d'accepter la course pour le moment."
      );
    } finally {
      setAccepting(false);
    }
  }

  // ✅ Vérifier le code + marquer livré si dropoff
  async function handleSubmitCode() {
    if (!order || !verifyingKind) return;
    if (!codeInput.trim()) {
      Alert.alert("Code manquant", "Entre le code de vérification.");
      return;
    }

    try {
      setSubmittingCode(true);

      // Normalisation : trim + majuscules
      const cleanCode = codeInput.trim().toUpperCase();

      const { data, error } = await supabase.rpc("verify_order_code", {
        p_order_id: order.id,
        p_input_code: cleanCode,
        p_code_type: verifyingKind, // "pickup" ou "dropoff"
      });

      console.log("verify_order_code mobile data", { data, error });

      if (error) {
        console.error("Erreur RPC verify_order_code:", error);
        Alert.alert(
          "Erreur",
          "Erreur serveur pendant la vérification du code."
        );
        return;
      }

      const success = (data as any)?.success === true;
      const message =
        (data as any)?.message ??
        (verifyingKind === "pickup"
          ? "Code pickup validé."
          : "Code de livraison validé.");

      if (!success) {
        Alert.alert("Code invalide", message);
        return;
      }

      // 🔁 Si c’est le code de LIVRAISON, on marque la commande comme livrée
      if (verifyingKind === "dropoff") {
        const { error: deliveredError } = await supabase.rpc(
          "driver_mark_delivered",
          { p_order_id: order.id }
        );

        if (deliveredError) {
          console.error(
            "Erreur driver_mark_delivered (mobile):",
            deliveredError
          );
          // On ne bloque pas l’UI, mais on a le log pour debug
        }
      }

      // Recharger la commande pour voir le statut mis à jour
      await fetchOrder();

      Alert.alert("Succès", message);
      closeCodeModal();
    } catch (e: any) {
      console.error("Erreur handleSubmitCode:", e);
      Alert.alert(
        "Erreur",
        e?.message ?? "Impossible de vérifier le code pour le moment."
      );
    } finally {
      setSubmittingCode(false);
    }
  }

  if (loading && !order) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
        <StatusBar barStyle="light-content" />
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ActivityIndicator size="large" />
          <Text style={{ marginTop: 8, color: "#9CA3AF" }}>
            Chargement de la commande...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!order) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
        <StatusBar barStyle="light-content" />
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 24,
          }}
        >
          <Text style={{ color: "#F9FAFB", fontSize: 16, marginBottom: 12 }}>
            Commande introuvable.
          </Text>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={{
              borderRadius: 999,
              borderWidth: 1,
              borderColor: "#4B5563",
              paddingHorizontal: 20,
              paddingVertical: 10,
            }}
          >
            <Text style={{ color: "#E5E7EB" }}>← Retour</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <StatusBar barStyle="light-content" />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
      >
        {/* RETOUR */}
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ marginTop: 12, marginBottom: 8 }}
        >
          <Text style={{ color: "#9CA3AF", fontSize: 13 }}>
            ← Retour au tableau de bord chauffeur
          </Text>
        </TouchableOpacity>

        {/* Titre */}
        <Text
          style={{
            color: "white",
            fontSize: 22,
            fontWeight: "800",
            marginBottom: 4,
          }}
        >
          Course — commande #{order.id.slice(0, 8)}
        </Text>
        <Text style={{ color: "#9CA3AF", fontSize: 13, marginBottom: 8 }}>
          Vue chauffeur : adresses, distance, temps estimé, codes pickup /
          livraison et rémunération.
        </Text>

        {/* Statut */}
        <View
          style={{
            alignSelf: "flex-start",
            borderRadius: 999,
            borderWidth: 1,
            borderColor: "#1D4ED8",
            paddingHorizontal: 10,
            paddingVertical: 4,
            marginBottom: 10,
          }}
        >
          <Text
            style={{
              color: "#BFDBFE",
              fontSize: 12,
              fontWeight: "600",
            }}
          >
            Statut : {formatStatusLabel(order.status)}
          </Text>
        </View>

        {/* Bouton accepter la course */}
        {canAccept && (
          <TouchableOpacity
            onPress={handleAccept}
            disabled={accepting}
            style={{
              borderRadius: 999,
              paddingVertical: 12,
              alignItems: "center",
              marginBottom: 12,
              backgroundColor: "#16A34A",
              opacity: accepting ? 0.7 : 1,
            }}
          >
            <Text
              style={{
                color: "white",
                fontSize: 14,
                fontWeight: "700",
              }}
            >
              {accepting ? "Acceptation..." : "Accepter cette course"}
            </Text>
          </TouchableOpacity>
        )}

        <Text
          style={{
            color: "#6B7280",
            fontSize: 11,
            marginBottom: 12,
          }}
        >
          Commande créée le : {formatDate(order.created_at)}
        </Text>

        {/* Bloc adresses */}
        <View
          style={{
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "#111827",
            backgroundColor: "#020617",
            padding: 14,
            marginBottom: 10,
          }}
        >
          <Text
            style={{
              color: "#E5E7EB",
              fontSize: 15,
              fontWeight: "700",
              marginBottom: 6,
            }}
          >
            Adresses de la course
          </Text>

          {order.restaurant_name && (
            <Text
              style={{
                color: "#9CA3AF",
                fontSize: 12,
                marginBottom: 4,
              }}
            >
              Restaurant :{" "}
              <Text style={{ color: "#E5E7EB", fontWeight: "500" }}>
                {order.restaurant_name}
              </Text>
            </Text>
          )}

          <Text
            style={{
              color: "#9CA3AF",
              fontSize: 12,
              marginBottom: 2,
            }}
          >
            Retrait{" "}
            <Text style={{ color: "#E5E7EB", fontWeight: "500" }}>
              {order.pickup_address ?? "—"}
            </Text>
          </Text>
          <Text
            style={{
              color: "#9CA3AF",
              fontSize: 12,
              marginBottom: 2,
            }}
          >
            Livraison{" "}
            <Text style={{ color: "#E5E7EB", fontWeight: "500" }}>
              {order.dropoff_address ?? "—"}
            </Text>
          </Text>
        </View>

        {/* Bloc course */}
        <View
          style={{
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "#111827",
            backgroundColor: "#020617",
            padding: 14,
            marginBottom: 10,
          }}
        >
          <Text
            style={{
              color: "#E5E7EB",
              fontSize: 15,
              fontWeight: "700",
              marginBottom: 6,
            }}
          >
            Course
          </Text>

          <Text style={{ color: "#9CA3AF", fontSize: 12, marginBottom: 2 }}>
            Distance :{" "}
            <Text style={{ color: "#E5E7EB", fontWeight: "600" }}>
              {order.distance_miles != null
                ? `${order.distance_miles.toFixed(1)} mi`
                : "—"}
            </Text>
          </Text>

          <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
            Temps estimé :{" "}
            <Text style={{ color: "#E5E7EB", fontWeight: "600" }}>
              {order.eta_minutes != null
                ? `${Math.round(order.eta_minutes)} min`
                : "—"}
            </Text>
          </Text>
        </View>

        {/* Bloc rémunération */}
        <View
          style={{
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "#111827",
            backgroundColor: "#020617",
            padding: 14,
            marginBottom: 10,
          }}
        >
          <Text
            style={{
              color: "#E5E7EB",
              fontSize: 15,
              fontWeight: "700",
              marginBottom: 6,
            }}
          >
            Ta rémunération chauffeur (estimation)
          </Text>

          <Text style={{ color: "#9CA3AF", fontSize: 12, marginBottom: 4 }}>
            Ta part chauffeur estimée :{" "}
            <Text style={{ color: "#22C55E", fontWeight: "700" }}>
              {order.driver_delivery_payout != null
                ? `${order.driver_delivery_payout.toFixed(2)} USD`
                : "—"}
            </Text>
          </Text>

          <Text style={{ color: "#6B7280", fontSize: 11 }}>
            Basé sur la répartition officielle MMD Delivery. Le montant final
            pourra être ajusté si nécessaire.
          </Text>
        </View>

        {/* Bloc codes de vérification */}
        <View
          style={{
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "#111827",
            backgroundColor: "#020617",
            padding: 14,
            marginBottom: 16,
          }}
        >
          <Text
            style={{
              color: "#E5E7EB",
              fontSize: 15,
              fontWeight: "700",
              marginBottom: 10,
            }}
          >
            Codes de vérification
          </Text>

          <TouchableOpacity
            disabled={!canPickup}
            onPress={() => openCodeModal("pickup")}
            style={{
              borderRadius: 999,
              paddingVertical: 12,
              alignItems: "center",
              marginBottom: 8,
              backgroundColor: canPickup ? "#16A34A" : "#111827",
              opacity: canPickup ? 1 : 0.5,
            }}
          >
            <Text
              style={{
                color: canPickup ? "white" : "#6B7280",
                fontSize: 13,
                fontWeight: "600",
              }}
            >
              Je récupère la commande (code de ramassage)
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            disabled={!canDeliver}
            onPress={() => openCodeModal("dropoff")}
            style={{
              borderRadius: 999,
              paddingVertical: 12,
              alignItems: "center",
              backgroundColor: canDeliver ? "#1D4ED8" : "#111827",
              opacity: canDeliver ? 1 : 0.5,
            }}
          >
            <Text
              style={{
                color: canDeliver ? "white" : "#6B7280",
                fontSize: 13,
                fontWeight: "600",
              }}
            >
              Je livre la commande (code de livraison)
            </Text>
          </TouchableOpacity>
        </View>

        {/* Chat (placeholder) */}
        <TouchableOpacity
          disabled
          style={{
            borderRadius: 999,
            borderWidth: 1,
            borderColor: "#4B5563",
            paddingVertical: 10,
            alignItems: "center",
          }}
        >
          <Text
            style={{
              color: "#9CA3AF",
              fontSize: 13,
              fontWeight: "500",
            }}
          >
            Ouvrir le chat (à venir)
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* MODAL CODE */}
      <Modal
        transparent
        visible={verifyingKind !== null}
        animationType="fade"
        onRequestClose={closeCodeModal}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.6)",
            justifyContent: "center",
            alignItems: "center",
            paddingHorizontal: 24,
          }}
        >
          <View
            style={{
              width: "100%",
              borderRadius: 16,
              backgroundColor: "#020617",
              borderWidth: 1,
              borderColor: "#111827",
              padding: 16,
            }}
          >
            <Text
              style={{
                color: "#F9FAFB",
                fontSize: 16,
                fontWeight: "700",
                marginBottom: 8,
              }}
            >
              {verifyingKind === "pickup"
                ? "Code de ramassage"
                : "Code de livraison"}
            </Text>
            <Text
              style={{
                color: "#9CA3AF",
                fontSize: 13,
                marginBottom: 10,
              }}
            >
              Demande le code à la personne (restaurant ou client) et saisis-le
              ci-dessous.
            </Text>

            <TextInput
              value={codeInput}
              onChangeText={setCodeInput}
              placeholder={
                verifyingKind === "pickup" ? "Code pickup" : "Code livraison"
              }
              placeholderTextColor="#6B7280"
              autoCapitalize="characters"
              style={{
                borderRadius: 10,
                borderWidth: 1,
                borderColor: "#4B5563",
                paddingHorizontal: 12,
                paddingVertical: 8,
                color: "#F9FAFB",
                marginBottom: 12,
              }}
            />

            <View
              style={{
                flexDirection: "row",
                justifyContent: "flex-end",
                gap: 8,
              }}
            >
              <TouchableOpacity
                onPress={closeCodeModal}
                disabled={submittingCode}
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 14,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: "#4B5563",
                }}
              >
                <Text
                  style={{
                    color: "#E5E7EB",
                    fontSize: 13,
                  }}
                >
                  Annuler
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleSubmitCode}
                disabled={submittingCode}
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 16,
                  borderRadius: 999,
                  backgroundColor: "#22C55E",
                  opacity: submittingCode ? 0.6 : 1,
                }}
              >
                <Text
                  style={{
                    color: "white",
                    fontSize: 13,
                    fontWeight: "600",
                  }}
                >
                  {submittingCode ? "Vérification..." : "Valider le code"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
