import React, { useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StatusBar,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { supabase } from "../lib/supabase";

type Nav = NativeStackNavigationProp<RootStackParamList, "ClientNewOrder">;

// ✅ Token Mapbox
const MAPBOX_TOKEN =
  "pk.eyJ1IjoibWFsYWRobzUxNiIsImEiOiJjbWk1aXZudXAyNmFsMmltemIydnFueGpwIn0.SNDPOErouV1D7ZsoE8eHBg";

// 🔢 Génère un code pickup/livraison
function generateCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// 🌍 Geocoding
async function geocodeAddress(address: string) {
  if (!MAPBOX_TOKEN) throw new Error("Token Mapbox manquant.");

  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
    address
  )}.json?access_token=${MAPBOX_TOKEN}&limit=1`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Erreur Mapbox geocoding.");

  const json = await res.json();
  const feature = json.features?.[0];

  if (!feature || !feature.center) {
    throw new Error("Adresse introuvable.");
  }

  const [lon, lat] = feature.center;
  return { lat, lon };
}

// 🚗 Directions API
async function getDistanceAndDuration(
  pickupAddress: string,
  dropoffAddress: string
) {
  const pickupPoint = await geocodeAddress(pickupAddress);
  const dropoffPoint = await geocodeAddress(dropoffAddress);

  const url = `https://api.mapbox.com/directions/v5/mapbox.driving/${pickupPoint.lon},${pickupPoint.lat};${dropoffPoint.lon},${dropoffPoint.lat}?geometries=geojson&overview=simplified&access_token=${MAPBOX_TOKEN}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Erreur Mapbox directions.");

  const json = await res.json();
  const route = json.routes?.[0];

  if (!route) throw new Error("Aucun itinéraire trouvé.");

  const distanceMeters = route.distance ?? 0;
  const durationSeconds = route.duration ?? 0;

  const distanceMiles = distanceMeters / 1609.34;
  const durationMinutes = durationSeconds / 60;

  return { distanceMiles, durationMinutes };
}

/*  
======================================================
💰 FORMULE OFFICIELLE MMD DELIVERY (version Uber-like)
======================================================
Base = 2.50$
Per Mile = 0.90$
Per Minute = 0.15$
Minimum = 3.49$
======================================================
*/
function computeRidePrice(distanceMiles: number, durationMinutes: number) {
  const BASE_FARE = 2.5;
  const PER_MILE = 0.9;
  const PER_MINUTE = 0.15;
  const MIN_FARE = 3.49;

  const raw =
    BASE_FARE +
    distanceMiles * PER_MILE +
    durationMinutes * PER_MINUTE;

  const total = Math.max(MIN_FARE, Number(raw.toFixed(2)));
  return total;
}

export function ClientNewOrderScreen() {
  const navigation = useNavigation<Nav>();

  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleCreateOrder() {
    if (!pickup.trim() || !dropoff.trim()) {
      Alert.alert(
        "Champs manquants",
        "Merci de remplir l’adresse pickup et l’adresse de livraison."
      );
      return;
    }

    setLoading(true);

    try {
      // User
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;
      if (!user) throw new Error("Utilisateur non connecté.");

      const pickupAddress = pickup.trim();
      const dropoffAddress = dropoff.trim();

      // Codes
      const pickupCode = generateCode();
      const deliveryCode = generateCode();

      // Distance + prix
      let distanceMiles: number | null = null;
      let totalPrice: number | null = null;

      try {
        const { distanceMiles: d, durationMinutes } =
          await getDistanceAndDuration(pickupAddress, dropoffAddress);

        distanceMiles = Number(d.toFixed(2));
        totalPrice = computeRidePrice(distanceMiles, durationMinutes);
      } catch (err) {
        console.error("Erreur Mapbox:", err);
        Alert.alert(
          "Info",
          "Impossible de calculer la distance et le prix automatiquement."
        );
      }

      // Insert Supabase
      const { data, error } = await supabase
        .from("orders")
        .insert({
          type: "ride",
          status: "pending",
          created_by: user.id,
          client_user_id: user.id,
          restaurant_id: "306ef52d-aa3c-4475-a7f3-abe0f9f6817c",

          pickup_address: pickupAddress,
          dropoff_address: dropoffAddress,

          pickup_code: pickupCode,
          delivery_code: deliveryCode,

          distance_miles: distanceMiles,
          total: totalPrice,
        })
        .select("id")
        .single();

      if (error) throw error;

      Alert.alert(
        "Commande créée",
        `Code pickup : ${pickupCode}\nCode livraison : ${deliveryCode}`,
        [{ text: "OK", onPress: () => navigation.goBack() }]
      );

      setPickup("");
      setDropoff("");
    } catch (e: any) {
      console.error(e);
      Alert.alert(
        "Erreur",
        e?.message ?? "Impossible de créer la commande."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <StatusBar barStyle="light-content" />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24 }}>
          <Text
            style={{
              fontSize: 24,
              fontWeight: "700",
              color: "white",
              marginBottom: 8,
            }}
          >
            Nouvelle commande (client)
          </Text>

          <Text
            style={{
              color: "#9CA3AF",
              marginBottom: 24,
            }}
          >
            Indique l’adresse de départ et l’adresse de livraison.
          </Text>

          {/* Pickup */}
          <Text style={{ color: "#E5E7EB", marginBottom: 8 }}>
            Adresse pickup
          </Text>
          <TextInput
            placeholder="Ex: 123 Main St"
            placeholderTextColor="#6B7280"
            style={{
              borderWidth: 1,
              borderColor: "#374151",
              borderRadius: 8,
              padding: 12,
              color: "white",
              marginBottom: 16,
            }}
            value={pickup}
            onChangeText={setPickup}
          />

          {/* Dropoff */}
          <Text style={{ color: "#E5E7EB", marginBottom: 8 }}>
            Adresse de livraison
          </Text>
          <TextInput
            placeholder="Ex: 45 Broadway"
            placeholderTextColor="#6B7280"
            style={{
              borderWidth: 1,
              borderColor: "#374151",
              borderRadius: 8,
              padding: 12,
              color: "white",
              marginBottom: 24,
            }}
            value={dropoff}
            onChangeText={setDropoff}
          />

          {/* Submit */}
          <TouchableOpacity
            onPress={handleCreateOrder}
            disabled={loading}
            style={{
              backgroundColor: "#3B82F6",
              paddingVertical: 14,
              borderRadius: 8,
              alignItems: "center",
              marginBottom: 12,
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text
                style={{
                  color: "white",
                  fontSize: 16,
                  fontWeight: "600",
                }}
              >
                Valider la commande
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={{
              borderWidth: 1,
              borderColor: "#4B5563",
              paddingVertical: 14,
              borderRadius: 8,
              alignItems: "center",
            }}
          >
            <Text
              style={{
                color: "#E5E7EB",
                fontSize: 16,
              }}
            >
              Retour à l’espace client
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
