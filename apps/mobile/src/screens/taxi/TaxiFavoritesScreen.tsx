import React, { useCallback, useEffect, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StatusBar,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import {
  addTaxiFavoriteDriver,
  fetchTaxiFavoriteDrivers,
  removeTaxiFavoriteDriver,
} from "../../lib/taxiClientApi";

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiFavorites">;

type FavoriteRow = {
  id: string;
  driver_user_id: string;
  created_at: string;
};

export default function TaxiFavoritesScreen() {
  const navigation = useNavigation<Nav>();
  const [favorites, setFavorites] = useState<FavoriteRow[]>([]);
  const [driverId, setDriverId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchTaxiFavoriteDrivers();
      setFavorites((res?.favorites as FavoriteRow[]) ?? []);
    } catch (e: unknown) {
      Alert.alert("Favorites", e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdd() {
    const id = driverId.trim();
    if (!id) return;
    setSaving(true);
    try {
      await addTaxiFavoriteDriver(id);
      setDriverId("");
      await load();
    } catch (e: unknown) {
      Alert.alert("Favorites", e instanceof Error ? e.message : "Add failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id: string) {
    setSaving(true);
    try {
      await removeTaxiFavoriteDriver(id);
      await load();
    } catch (e: unknown) {
      Alert.alert("Favorites", e instanceof Error ? e.message : "Remove failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ color: "#93C5FD" }}>← Back</Text>
        </TouchableOpacity>

        <Text style={{ color: "#fff", fontSize: 26, fontWeight: "800" }}>
          Favorite drivers
        </Text>

        <TextInput
          value={driverId}
          onChangeText={setDriverId}
          placeholder="Driver user ID"
          placeholderTextColor="#64748B"
          style={{
            backgroundColor: "rgba(15,23,42,0.95)",
            borderWidth: 1,
            borderColor: "#334155",
            borderRadius: 14,
            padding: 14,
            color: "#F8FAFC",
          }}
        />

        <TouchableOpacity
          onPress={handleAdd}
          disabled={saving}
          style={{
            backgroundColor: "#F59E0B",
            paddingVertical: 14,
            borderRadius: 14,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#111827", fontWeight: "800" }}>
            {saving ? "Saving…" : "Add favorite"}
          </Text>
        </TouchableOpacity>

        {loading ? <ActivityIndicator color="#F59E0B" /> : null}

        {favorites.map((row) => (
          <View
            key={row.id}
            style={{
              padding: 14,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: "#334155",
              backgroundColor: "rgba(15,23,42,0.95)",
            }}
          >
            <Text style={{ color: "#E2E8F0", fontWeight: "700" }}>
              {row.driver_user_id}
            </Text>
            <TouchableOpacity onPress={() => handleRemove(row.driver_user_id)}>
              <Text style={{ color: "#FCA5A5", marginTop: 8 }}>Remove</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
