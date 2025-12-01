import React, { useEffect, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StatusBar,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  ScrollView,
} from "react-native";
import { useRoute } from "@react-navigation/native";
import { supabase } from "../lib/supabase";

type Order = {
  id: string;
  status: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_code: string | null;
  delivery_code: string | null;
  distance_miles: number | null;
  total: number | null;
  created_at: string | null;
};

export function DriverOrderDetailsScreen() {
  const route = useRoute<any>();
  const { orderId } = route.params;

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);

  // 🔐 Modals + inputs pour les codes
  const [pickupCodeInput, setPickupCodeInput] = useState("");
  const [deliveryCodeInput, setDeliveryCodeInput] = useState("");
  const [showPickupModal, setShowPickupModal] = useState(false);
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);

  // 🔄 Charger la commande
  async function fetchOrder() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("orders")
        .select(
          `
          id,
          status,
          pickup_address,
          dropoff_address,
          pickup_code,
          delivery_code,
          distance_miles,
          total,
          created_at
        `
        )
        .eq("id", orderId)
        .single();

      if (error) {
        console.error(error);
        Alert.alert("Erreur", "Impossible de charger la commande.");
        return;
      }
      setOrder(data as Order);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchOrder();
  }, [orderId]);

  // ✅ Validation du code pickup
  async function handleValidatePickup() {
    if (!order) return;

    const code = pickupCodeInput.trim();
    if (!code) {
      Alert.alert("Code requis", "Entre le code donné par le client.");
      return;
    }

    // 🔒 On compare avec le code stocké en base
    if (!order.pickup_code || code !== order.pickup_code) {
      Alert.alert("Code incorrect", "Le code de ramassage ne correspond pas.");
      return;
    }

    try {
      setUpdating(true);

      // 🔄 Mettre le statut à "dispatched" (en livraison)
      const { error } = await supabase
        .from("orders")
        .update({ status: "dispatched" })
        .eq("id", order.id);

      if (error) {
        console.error(error);
        Alert.alert("Erreur", "Impossible de valider le pickup.");
        return;
      }

      setShowPickupModal(false);
      setPickupCodeInput("");
      await fetchOrder();
      Alert.alert("Pickup validé", "Le code pickup est correct. Livraison en cours.");
    } finally {
      setUpdating(false);
    }
  }

  // ✅ Validation du code de livraison
  async function handleValidateDelivery() {
    if (!order) return;

    const code = deliveryCodeInput.trim();
    if (!code) {
      Alert.alert("Code requis", "Entre le code donné par le client.");
      return;
    }

    if (!order.delivery_code || code !== order.delivery_code) {
      Alert.alert(
        "Code incorrect",
        "Le code de livraison ne correspond pas. Vérifie avec le client."
      );
      return;
    }

    try {
      setUpdating(true);

      // 🔄 Mettre le statut à "delivered"
      const { error } = await supabase
        .from("orders")
        .update({ status: "delivered" })
        .eq("id", order.id);

      if (error) {
        console.error(error);
        Alert.alert("Erreur", "Impossible de valider la livraison.");
        return;
      }

      setShowDeliveryModal(false);
      setDeliveryCodeInput("");
      await fetchOrder();
      Alert.alert("Livraison validée", "Commande livrée avec succès.");
    } finally {
      setUpdating(false);
    }
  }

  if (loading || !order) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
        <StatusBar barStyle="light-content" />
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <ActivityIndicator />
          <Text style={{ color: "white", marginTop: 8 }}>
            Chargement de la commande...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text
          style={{
            color: "white",
            fontSize: 22,
            fontWeight: "700",
            marginBottom: 12,
          }}
        >
          Détail commande chauffeur
        </Text>

        <View
          style={{
            backgroundColor: "#111827",
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <Text style={{ color: "#9CA3AF", marginBottom: 4 }}>
            ID : {order.id}
          </Text>
          <Text style={{ color: "white", fontWeight: "600", marginBottom: 4 }}>
            Statut : {order.status}
          </Text>
          <Text style={{ color: "#9CA3AF", marginBottom: 4 }}>
            Pickup : {order.pickup_address || "—"}
          </Text>
          <Text style={{ color: "#9CA3AF", marginBottom: 4 }}>
            Livraison : {order.dropoff_address || "—"}
          </Text>
          <Text style={{ color: "#9CA3AF", marginBottom: 4 }}>
            Distance :{" "}
            {order.distance_miles != null
              ? `${order.distance_miles.toFixed(2)} mi`
              : "—"}
          </Text>
          <Text style={{ color: "#9CA3AF" }}>
            Total :{" "}
            {order.total != null ? `${order.total.toFixed(2)} USD` : "—"}
          </Text>
        </View>

        {/* 🔵 Bouton pour valider le pickup */}
        <TouchableOpacity
          style={{
            backgroundColor: "#2563EB",
            paddingVertical: 14,
            borderRadius: 999,
            alignItems: "center",
            marginBottom: 12,
            opacity: updating ? 0.7 : 1,
          }}
          disabled={updating}
          onPress={() => setShowPickupModal(true)}
        >
          <Text
            style={{
              color: "white",
              fontSize: 16,
              fontWeight: "600",
            }}
          >
            Valider le code pickup
          </Text>
        </TouchableOpacity>

        {/* 🟢 Bouton pour valider la livraison */}
        <TouchableOpacity
          style={{
            backgroundColor: "#16A34A",
            paddingVertical: 14,
            borderRadius: 999,
            alignItems: "center",
            opacity: updating ? 0.7 : 1,
          }}
          disabled={updating}
          onPress={() => setShowDeliveryModal(true)}
        >
          <Text
            style={{
              color: "white",
              fontSize: 16,
              fontWeight: "600",
            }}
          >
            Valider le code de livraison
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* 🔐 Modal code pickup */}
      <Modal visible={showPickupModal} transparent animationType="fade">
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.7)",
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
          }}
        >
          <View
            style={{
              backgroundColor: "#020617",
              borderRadius: 16,
              padding: 20,
              width: "100%",
            }}
          >
            <Text
              style={{
                color: "white",
                fontSize: 18,
                fontWeight: "600",
                marginBottom: 12,
              }}
            >
              Code pickup
            </Text>
            <Text style={{ color: "#9CA3AF", marginBottom: 12 }}>
              Demande au client le code de ramassage et entre-le ici.
            </Text>
            <TextInput
              value={pickupCodeInput}
              onChangeText={setPickupCodeInput}
              placeholder="Code pickup"
              placeholderTextColor="#6B7280"
              keyboardType="number-pad"
              style={{
                backgroundColor: "#111827",
                borderRadius: 8,
                paddingHorizontal: 12,
                paddingVertical: 10,
                color: "white",
                marginBottom: 16,
              }}
            />
            <View
              style={{
                flexDirection: "row",
                justifyContent: "flex-end",
                gap: 12,
              }}
            >
              <TouchableOpacity
                onPress={() => setShowPickupModal(false)}
                style={{ paddingVertical: 10, paddingHorizontal: 16 }}
              >
                <Text style={{ color: "#9CA3AF" }}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleValidatePickup}
                style={{
                  backgroundColor: "#2563EB",
                  paddingVertical: 10,
                  paddingHorizontal: 16,
                  borderRadius: 999,
                }}
              >
                <Text
                  style={{ color: "white", fontWeight: "600", fontSize: 15 }}
                >
                  Valider
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 🔐 Modal code livraison */}
      <Modal visible={showDeliveryModal} transparent animationType="fade">
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.7)",
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
          }}
        >
          <View
            style={{
              backgroundColor: "#020617",
              borderRadius: 16,
              padding: 20,
              width: "100%",
            }}
          >
            <Text
              style={{
                color: "white",
                fontSize: 18,
                fontWeight: "600",
                marginBottom: 12,
              }}
            >
              Code de livraison
            </Text>
            <Text style={{ color: "#9CA3AF", marginBottom: 12 }}>
              Demande au client le code de livraison à l&apos;arrivée.
            </Text>
            <TextInput
              value={deliveryCodeInput}
              onChangeText={setDeliveryCodeInput}
              placeholder="Code de livraison"
              placeholderTextColor="#6B7280"
              keyboardType="number-pad"
              style={{
                backgroundColor: "#111827",
                borderRadius: 8,
                paddingHorizontal: 12,
                paddingVertical: 10,
                color: "white",
                marginBottom: 16,
              }}
            />
            <View
              style={{
                flexDirection: "row",
                justifyContent: "flex-end",
                gap: 12,
              }}
            >
              <TouchableOpacity
                onPress={() => setShowDeliveryModal(false)}
                style={{ paddingVertical: 10, paddingHorizontal: 16 }}
              >
                <Text style={{ color: "#9CA3AF" }}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleValidateDelivery}
                style={{
                  backgroundColor: "#16A34A",
                  paddingVertical: 10,
                  paddingHorizontal: 16,
                  borderRadius: 999,
                }}
              >
                <Text
                  style={{ color: "white", fontWeight: "600", fontSize: 15 }}
                >
                  Valider
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
