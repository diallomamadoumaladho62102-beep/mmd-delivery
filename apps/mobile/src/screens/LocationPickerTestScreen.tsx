import React, { useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  ScrollView,
  Alert,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import MMDLocationPicker, {
  type MMDLocationPickerValue,
} from "../components/location/MMDLocationPicker";
import type { MmdLocationPoint } from "../lib/mmdLocationApi";

type Nav = NativeStackNavigationProp<RootStackParamList, "LocationPickerTest">;

export default function LocationPickerTestScreen() {
  const navigation = useNavigation<Nav>();
  const [savedLocation, setSavedLocation] = useState<MmdLocationPoint | null>(null);

  async function handleSave(value: MMDLocationPickerValue) {
    setSavedLocation(value.location);
    Alert.alert(
      "Location saved",
      `location.id = ${value.location.id}\nconfidence = ${value.location.confidence_score}`,
      [{ text: "OK" }]
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0F172A" }}>
      <StatusBar barStyle="light-content" />
      <View
        style={{
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: "#1E293B",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ color: "#94A3B8", fontWeight: "600" }}>Back</Text>
        </TouchableOpacity>
        <Text style={{ color: "#F8FAFC", fontWeight: "700" }}>
          Africa Location Test (GN)
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {savedLocation ? (
        <ScrollView
          style={{ maxHeight: 140, borderBottomWidth: 1, borderBottomColor: "#1E293B" }}
          contentContainerStyle={{ padding: 16, gap: 6 }}
        >
          <Text style={{ color: "#22C55E", fontWeight: "700" }}>Last saved location_point</Text>
          <Text style={{ color: "#E2E8F0", fontSize: 12 }} selectable>
            id: {savedLocation.id}
          </Text>
          <Text style={{ color: "#94A3B8", fontSize: 12 }} selectable>
            pin: {savedLocation.pin_lat}, {savedLocation.pin_lng}
          </Text>
          <Text style={{ color: "#94A3B8", fontSize: 12 }}>
            confidence: {savedLocation.confidence_score}
          </Text>
          {savedLocation.location_photo_path ? (
            <Text style={{ color: "#94A3B8", fontSize: 12 }} selectable>
              photo: {savedLocation.location_photo_path}
            </Text>
          ) : null}
        </ScrollView>
      ) : null}

      <MMDLocationPicker
        countryCode="GN"
        title="Guinea exact location (internal test)"
        submitLabel="Save test location"
        onSave={handleSave}
        onCancel={() => navigation.goBack()}
      />
    </SafeAreaView>
  );
}
