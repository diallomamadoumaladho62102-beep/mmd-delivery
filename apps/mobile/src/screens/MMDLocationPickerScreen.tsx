import React from "react";
import { SafeAreaView, StatusBar, View, Text, TouchableOpacity } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import MMDLocationPicker, {
  type MMDLocationPickerValue,
} from "../components/location/MMDLocationPicker";
import type { MmdLocationPickerContext } from "../lib/mmdLocationDisplay";

type Nav = NativeStackNavigationProp<RootStackParamList, "MMDLocationPicker">;
type PickerRoute = RouteProp<RootStackParamList, "MMDLocationPicker">;

export default function MMDLocationPickerScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<PickerRoute>();
  const {
    countryCode = "GN",
    title = "Exact location",
    submitLabel = "Use this location",
    returnTo,
    pickerContext,
  } = route.params;

  async function handleSave(value: MMDLocationPickerValue) {
    const result = {
      context: pickerContext as MmdLocationPickerContext,
      location: value.location,
    };

    navigation.navigate({
      name: returnTo,
      params: { locationPickerResult: result },
      merge: true,
    } as never);

    navigation.goBack();
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
        <Text style={{ color: "#F8FAFC", fontWeight: "700" }} numberOfLines={1}>
          {title}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <MMDLocationPicker
        countryCode={countryCode}
        title={title}
        submitLabel={submitLabel}
        onSave={handleSave}
        onCancel={() => navigation.goBack()}
      />
    </SafeAreaView>
  );
}
