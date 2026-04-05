import React from "react";
import {
  SafeAreaView,
  View,
  Text,
  StatusBar,
  TouchableOpacity,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";

type HomeScreenNavigation = NativeStackNavigationProp<
  RootStackParamList,
  "Home"
>;

export function HomeScreen() {
  const navigation = useNavigation<HomeScreenNavigation>();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#111827" }}>
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1, padding: 24, justifyContent: "center" }}>
        <Text
          style={{
            fontSize: 28,
            fontWeight: "700",
            color: "white",
            marginBottom: 12,
          }}
        >
          MMD Delivery — Mobile
        </Text>

        <Text
          style={{
            fontSize: 16,
            color: "#9CA3AF",
            marginBottom: 32,
          }}
        >
          Si tu vois cet écran sur ton iPhone dans Expo Go, la base mobile est
          prête.
        </Text>

        <TouchableOpacity
          style={{
            backgroundColor: "#EF4444",
            paddingHorizontal: 20,
            paddingVertical: 12,
            borderRadius: 999,
            alignSelf: "flex-start",
          }}
          onPress={() => {
            navigation.navigate("RoleSelection");
          }}
        >
          <Text
            style={{
              color: "white",
              fontWeight: "600",
              fontSize: 16,
            }}
          >
            Continuer le setup
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
