import React from "react";
import {
  SafeAreaView,
  View,
  Text,
  StatusBar,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { supabase } from "../lib/supabase";

type Nav = NativeStackNavigationProp<RootStackParamList, "DriverHome">;

type OrderStatus =
  | "pending"
  | "accepted"
  | "prepared"
  | "ready"
  | "dispatched"
  | "delivered"
  | "canceled";

type OrderKind = "pickup_dropoff" | "food" | string;

type DriverOrder = {
  id: string;
  kind: OrderKind;
  status: OrderStatus;
  created_at: string | null;
  restaurant_name: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  distance_miles: number | null;
  delivery_fee: number | null;
  driver_delivery_payout: number | null;
  total: number | null;
};

export default function DriverHomeScreen() {
  const navigation = useNavigation<Nav>();

  const [loading, setLoading] = React.useState(false);
  const [orders, setOrders] = React.useState<DriverOrder[]>([]);
  const [availableOrders, setAvailableOrders] = React.useState<DriverOrder[]>(
    []
  );
  const [error, setError] = React.useState<string | null>(null);

  // Offre en grande carte + chrono
  const [activeOffer, setActiveOffer] = React.useState<DriverOrder | null>(
    null
  );
  const [countdown, setCountdown] = React.useState<number>(60);

  // 🔁 Recharger à chaque fois qu'on revient sur l'écran
  useFocusEffect(
    React.useCallback(() => {
      void fetchDriverOrders();
      void fetchAvailableOrders();
    }, [])
  );

  async function fetchDriverOrders() {
    try {
      setLoading(true);
      setError(null);

      // 1) Récupérer la session du chauffeur
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session) {
        setError("Tu dois être connecté en tant que chauffeur.");
        setOrders([]);
        setAvailableOrders([]);
        return;
      }

      const driverId = sessionData.session.user.id;

      // 2) Chercher les commandes où ce user est membre "driver"
      const { data: memberships, error: membershipError } = await supabase
        .from("order_members")
        .select("order_id")
        .eq("user_id", driverId)
        .eq("role", "driver");

      if (membershipError) throw membershipError;

      const orderIds =
        (memberships ?? []).map((m: any) => m.order_id).filter(Boolean);

      if (orderIds.length === 0) {
        setOrders([]);
      } else {
        // 3) Charger les infos des commandes
        const { data: ordersData, error: ordersError } = await supabase
          .from("orders")
          .select(
            `
            id,
            kind,
            status,
            created_at,
            restaurant_name,
            pickup_address,
            dropoff_address,
            distance_miles,
            delivery_fee,
            driver_delivery_payout,
            total
          `
          )
          .in("id", orderIds)
          .order("created_at", { ascending: false });

        if (ordersError) throw ordersError;

        setOrders((ordersData as any as DriverOrder[]) ?? []);
      }
    } catch (e: any) {
      console.log("Erreur chargement commandes driver:", e);
      setError(
        e?.message ??
          "Impossible de charger tes commandes chauffeur pour le moment."
      );
    } finally {
      setLoading(false);
    }
  }

  // 🔄 Charger les courses PRÊTES sans chauffeur -> pour la grande carte
  async function fetchAvailableOrders() {
    try {
      const { data, error } = await supabase
        .from("orders")
        .select(
          `
          id,
          kind,
          status,
          created_at,
          restaurant_name,
          pickup_address,
          dropoff_address,
          distance_miles,
          delivery_fee,
          driver_delivery_payout,
          total
        `
        )
        .eq("kind", "food")
        .in("status", ["ready"]); // ⚠️ On ne montre QUE les commandes prêtes

      if (error) {
        console.log("Erreur fetchAvailableOrders:", error);
        return;
      }

      const list = (data as any as DriverOrder[]) ?? [];
      setAvailableOrders(list);

      // S'il y a une course prête et qu'on n'a pas encore d'offre active → on affiche en grande carte
      if (list.length > 0 && !activeOffer) {
        setActiveOffer(list[0]);
        setCountdown(60);
      }
    } catch (e) {
      console.log("Exception fetchAvailableOrders:", e);
    }
  }

  // Gestion du chrono pour la grande carte
  React.useEffect(() => {
    if (!activeOffer) return;
    if (countdown <= 0) {
      // Temps écoulé → on ferme l'offre
      setActiveOffer(null);
      return;
    }
    const timer = setTimeout(() => {
      setCountdown((c) => c - 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [activeOffer, countdown]);

  function formatDate(iso: string | null) {
    if (!iso) return "—";
    const d = new Date(iso);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }

  function formatStatus(status: OrderStatus) {
    switch (status) {
      case "pending":
        return "En attente (restaurant)";
      case "accepted":
        return "Acceptée";
      case "prepared":
        return "En préparation";
      case "ready":
        return "Prête";
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

  function formatKind(kind: OrderKind, restaurantName: string | null) {
    if (kind === "food") {
      return restaurantName
        ? `Commande restaurant · ${restaurantName}`
        : "Commande restaurant";
    }
    if (kind === "pickup_dropoff") {
      return "Course pickup / dropoff";
    }
    return kind;
  }

  function handleOpenOrder(orderId: string) {
    navigation.navigate("DriverOrderDetails", { orderId });
  }

  // Accepter l'offre en grande carte → pour l’instant, on va sur l’écran détails
  function handleAcceptActiveOffer() {
    if (!activeOffer) return;
    const id = activeOffer.id;
    setActiveOffer(null);
    navigation.navigate("DriverOrderDetails", { orderId: id });
  }

  function handleDeclineActiveOffer() {
    setActiveOffer(null);
  }

  // 🧨 SI UNE OFFRE ACTIVE EXISTE → on affiche UNIQUEMENT la grande carte
  if (activeOffer) {
    const gain =
      activeOffer.driver_delivery_payout ??
      activeOffer.delivery_fee ??
      activeOffer.total;

    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
        <StatusBar barStyle="light-content" />
        <View
          style={{
            flex: 1,
            paddingHorizontal: 20,
            paddingTop: 24,
            justifyContent: "center",
          }}
        >
          {/* Titre + chrono */}
          <View style={{ alignItems: "center", marginBottom: 16 }}>
            <Text
              style={{
                color: "#E5E7EB",
                fontSize: 20,
                fontWeight: "800",
                marginBottom: 4,
              }}
            >
              Nouvelle course
            </Text>
            <Text
              style={{
                color: "#F97316",
                fontSize: 16,
                fontWeight: "700",
              }}
            >
              {countdown}s
            </Text>
          </View>

          {/* Grande carte */}
          <View
            style={{
              backgroundColor: "#020617",
              borderRadius: 16,
              borderWidth: 1,
              borderColor: "#1F2937",
              padding: 16,
            }}
          >
            <Text
              style={{
                color: "#93C5FD",
                fontSize: 14,
                marginBottom: 8,
              }}
            >
              {formatKind(activeOffer.kind, activeOffer.restaurant_name)}
            </Text>

            {/* Pickup & dropoff */}
            <View style={{ marginBottom: 12 }}>
              <Text
                style={{
                  color: "#9CA3AF",
                  fontSize: 13,
                  marginBottom: 4,
                }}
              >
                Pickup :
              </Text>
              <Text
                style={{
                  color: "#E5E7EB",
                  fontSize: 14,
                  fontWeight: "500",
                }}
              >
                {activeOffer.pickup_address ?? "—"}
              </Text>
            </View>

            <View style={{ marginBottom: 12 }}>
              <Text
                style={{
                  color: "#9CA3AF",
                  fontSize: 13,
                  marginBottom: 4,
                }}
              >
                Dropoff :
              </Text>
              <Text
                style={{
                  color: "#E5E7EB",
                  fontSize: 14,
                  fontWeight: "500",
                }}
              >
                {activeOffer.dropoff_address ?? "—"}
              </Text>
            </View>

            {/* Distance & gain */}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                marginTop: 4,
                marginBottom: 8,
              }}
            >
              <View>
                <Text
                  style={{
                    color: "#9CA3AF",
                    fontSize: 12,
                    marginBottom: 2,
                  }}
                >
                  Distance estimée
                </Text>
                <Text
                  style={{
                    color: "#E5E7EB",
                    fontSize: 16,
                    fontWeight: "700",
                  }}
                >
                  {activeOffer.distance_miles != null
                    ? `${activeOffer.distance_miles.toFixed(2)} mi`
                    : "—"}
                </Text>
              </View>

              <View style={{ alignItems: "flex-end" }}>
                <Text
                  style={{
                    color: "#9CA3AF",
                    fontSize: 12,
                    marginBottom: 2,
                  }}
                >
                  Gain estimé
                </Text>
                <Text
                  style={{
                    color: "#4ADE80",
                    fontSize: 16,
                    fontWeight: "800",
                  }}
                >
                  {gain != null ? `${gain.toFixed(2)} USD` : "—"}
                </Text>
              </View>
            </View>

            {/* Date / infos */}
            <Text
              style={{
                color: "#6B7280",
                fontSize: 11,
                marginTop: 4,
              }}
            >
              Créée : {formatDate(activeOffer.created_at)}
            </Text>
          </View>

          {/* Boutons Refuser / Accepter */}
          <View
            style={{
              flexDirection: "row",
              marginTop: 20,
              gap: 12,
            }}
          >
            <TouchableOpacity
              onPress={handleDeclineActiveOffer}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: "#4B5563",
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  color: "#E5E7EB",
                  fontSize: 15,
                  fontWeight: "600",
                }}
              >
                Refuser
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleAcceptActiveOffer}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 999,
                backgroundColor: "#22C55E",
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  color: "#022C22",
                  fontSize: 15,
                  fontWeight: "700",
                }}
              >
                Accepter
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // 🧱 Sinon → affichage normal des courses assignées
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 24 }}>
        {/* HEADER */}
        <View style={{ marginBottom: 16 }}>
          <Text
            style={{
              fontSize: 24,
              fontWeight: "800",
              color: "white",
              marginBottom: 4,
            }}
          >
            Tableau de bord chauffeur
          </Text>
          <Text style={{ color: "#9CA3AF", fontSize: 14 }}>
            Vois tes courses MMD en cours et ton historique.
          </Text>
        </View>

        {/* BOUTON POUR REVENIR À LA SÉLECTION DE RÔLE / ACCUEIL */}
        <TouchableOpacity
          onPress={() => navigation.navigate("RoleSelect")}
          style={{
            borderRadius: 999,
            borderWidth: 1,
            borderColor: "#4B5563",
            paddingVertical: 8,
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <Text
            style={{
              color: "#E5E7EB",
              fontSize: 13,
              fontWeight: "500",
            }}
          >
            ← Changer de rôle / retour accueil
          </Text>
        </TouchableOpacity>

        {/* BARRE STATUT / REFRESH */}
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <Text
            style={{
              color: "#E5E7EB",
              fontSize: 15,
              fontWeight: "600",
            }}
          >
            Mes courses (assignées à moi)
          </Text>

          <TouchableOpacity
            onPress={() => {
              void fetchDriverOrders();
              void fetchAvailableOrders();
            }}
          >
            <Text
              style={{
                color: "#3B82F6",
                fontSize: 12,
                fontWeight: "500",
              }}
            >
              Rafraîchir
            </Text>
          </TouchableOpacity>
        </View>

        {loading && (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              marginBottom: 10,
            }}
          >
            <ActivityIndicator color="#ffffff" />
            <Text style={{ color: "#9CA3AF", fontSize: 13 }}>
              Chargement de tes courses…
            </Text>
          </View>
        )}

        {error && (
          <Text
            style={{
              color: "#F97373",
              fontSize: 12,
              marginBottom: 8,
            }}
          >
            {error}
          </Text>
        )}

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 24 }}
        >
          {orders.length === 0 && !loading ? (
            <View
              style={{
                paddingVertical: 24,
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  color: "#9CA3AF",
                  fontSize: 13,
                  textAlign: "center",
                }}
              >
                Tu n’as pas encore de course assignée comme chauffeur.
              </Text>
              <Text
                style={{
                  color: "#6B7280",
                  fontSize: 12,
                  marginTop: 4,
                  textAlign: "center",
                }}
              >
                Une fois qu’une course est acceptée, elle apparaîtra ici.
              </Text>
            </View>
          ) : (
            orders.map((order) => (
              <TouchableOpacity
                key={order.id}
                onPress={() => handleOpenOrder(order.id)}
                style={{
                  backgroundColor: "#020617",
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "#1F2937",
                  padding: 12,
                  marginBottom: 10,
                }}
              >
                {/* Haut de la carte : id + statut */}
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    marginBottom: 4,
                  }}
                >
                  <Text
                    style={{
                      color: "#E5E7EB",
                      fontSize: 13,
                      fontWeight: "600",
                    }}
                  >
                    #{order.id.slice(0, 8)}
                  </Text>
                  <Text
                    style={{
                      color:
                        order.status === "delivered"
                          ? "#22C55E"
                          : order.status === "dispatched"
                          ? "#FBBF24"
                          : "#93C5FD",
                      fontSize: 12,
                      fontWeight: "600",
                    }}
                  >
                    {formatStatus(order.status)}
                  </Text>
                </View>

                {/* Type de course */}
                <Text
                  style={{
                    color: "#93C5FD",
                    fontSize: 12,
                    marginBottom: 4,
                  }}
                >
                  {formatKind(order.kind, order.restaurant_name)}
                </Text>

                <Text
                  style={{
                    color: "#6B7280",
                    fontSize: 11,
                    marginBottom: 6,
                  }}
                >
                  {formatDate(order.created_at)}
                </Text>

                {/* Adresses */}
                <Text
                  style={{
                    color: "#9CA3AF",
                    fontSize: 12,
                    marginBottom: 2,
                  }}
                >
                  Pickup:{" "}
                  <Text
                    style={{ color: "#E5E7EB", fontWeight: "500" }}
                    numberOfLines={1}
                  >
                    {order.pickup_address ?? "—"}
                  </Text>
                </Text>
                <Text
                  style={{
                    color: "#9CA3AF",
                    fontSize: 12,
                    marginBottom: 4,
                  }}
                >
                  Dropoff:{" "}
                  <Text
                    style={{ color: "#E5E7EB", fontWeight: "500" }}
                    numberOfLines={1}
                  >
                    {order.dropoff_address ?? "—"}
                  </Text>
                </Text>

                {/* Bas de carte : distance + prix chauffeur */}
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    marginTop: 4,
                  }}
                >
                  <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
                    Distance:{" "}
                    <Text style={{ color: "#E5E7EB", fontWeight: "600" }}>
                      {order.distance_miles != null
                        ? `${order.distance_miles.toFixed(2)} mi`
                        : "—"}
                    </Text>
                  </Text>

                  <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
                    Gain chauffeur:{" "}
                    <Text
                      style={{ color: "#E5E7EB", fontWeight: "700" }}
                    >
                      {order.driver_delivery_payout != null
                        ? `${order.driver_delivery_payout.toFixed(2)} USD`
                        : order.delivery_fee != null
                        ? `${order.delivery_fee.toFixed(2)} USD`
                        : order.total != null
                        ? `${order.total.toFixed(2)} USD`
                        : "—"}
                    </Text>
                  </Text>
                </View>

                <Text
                  style={{
                    marginTop: 6,
                    color: "#3B82F6",
                    fontSize: 12,
                    fontWeight: "600",
                    textAlign: "right",
                  }}
                >
                  Voir les détails →
                </Text>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
