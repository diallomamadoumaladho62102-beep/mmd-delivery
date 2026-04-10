import React, { useEffect, useRef } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  Image,
  Animated,
  Easing,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";

import { supabase } from "../lib/supabase";
import { setSelectedRole } from "../lib/authRole";
import { useTranslation } from "react-i18next";

type RoleSelectNav = NativeStackNavigationProp<RootStackParamList, "RoleSelect">;

export function RoleSelectScreen() {
  const navigation = useNavigation<RoleSelectNav>();
  const { t } = useTranslation();

  const logoScale = useRef(new Animated.Value(0.85)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const contentTranslateY = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 700,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.spring(logoScale, {
        toValue: 1,
        friction: 6,
        tension: 70,
        useNativeDriver: true,
      }),
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 850,
        delay: 180,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(contentTranslateY, {
        toValue: 0,
        duration: 850,
        delay: 180,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  }, [logoOpacity, logoScale, contentOpacity, contentTranslateY]);

  async function handlePress(role: "client" | "driver" | "restaurant") {
    await setSelectedRole(role);

    const { data } = await supabase.auth.getSession();
    const isLoggedIn = !!data.session;

    if (!isLoggedIn) {
      if (role === "client") {
        navigation.navigate("ClientAuth");
        return;
      }
      if (role === "driver") {
        navigation.navigate("DriverAuth");
        return;
      }
      navigation.navigate("RestaurantAuth");
      return;
    }

    if (role === "client") navigation.navigate("ClientHome");
    if (role === "driver") navigation.navigate("DriverTabs");
    if (role === "restaurant") navigation.navigate("RestaurantGate");
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <StatusBar barStyle="light-content" />

      <Animated.View
        style={{
          flex: 1,
          paddingHorizontal: 24,
          justifyContent: "center",
          opacity: contentOpacity,
          transform: [{ translateY: contentTranslateY }],
        }}
      >
        <View style={{ alignItems: "center", marginBottom: 34 }}>
          <Animated.View
            style={{
              opacity: logoOpacity,
              transform: [{ scale: logoScale }],
            }}
          >
            <Image
              source={require("../../assets/icon.png")}
              style={{
                width: 128,
                height: 128,
                borderRadius: 30,
                marginBottom: 18,
              }}
              resizeMode="contain"
            />
          </Animated.View>

          <Text
            style={{
              fontSize: 35,
              fontWeight: "900",
              color: "white",
              textAlign: "center",
              letterSpacing: 0.4,
              marginBottom: 8,
            }}
          >
            MMD Delivery
          </Text>

          <Text
            style={{
              fontSize: 18,
              color: "#F8FAFC",
              textAlign: "center",
              fontWeight: "700",
              marginBottom: 6,
            }}
          >
            We deliver with heart ❤️
          </Text>

          <Text
            style={{
              fontSize: 15,
              color: "#CBD5E1",
              textAlign: "center",
            }}
          >
            Fast, simple and reliable 🚀
          </Text>
        </View>

        <Text
          style={{
            fontSize: 34,
            fontWeight: "900",
            color: "white",
            marginBottom: 12,
            textAlign: "center",
            letterSpacing: 0.3,
          }}
        >
          {t("roleSelect.title", "Choose your mode")}
        </Text>

        <Text
          style={{
            fontSize: 16,
            color: "#94A3B8",
            marginBottom: 34,
            textAlign: "center",
            lineHeight: 22,
          }}
        >
          Choose a role to access your dedicated experience.
        </Text>

        <TouchableOpacity
          style={{
            backgroundColor: "#EF4444",
            paddingVertical: 18,
            borderRadius: 16,
            alignItems: "center",
            marginBottom: 16,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 6 },
            shadowOpacity: 0.28,
            shadowRadius: 8,
            elevation: 6,
          }}
          onPress={() => handlePress("client")}
          activeOpacity={0.82}
        >
          <Text
            style={{
              color: "white",
              fontSize: 20,
              fontWeight: "800",
              letterSpacing: 0.3,
            }}
          >
            Client
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            backgroundColor: "#FACC15",
            paddingVertical: 18,
            borderRadius: 16,
            alignItems: "center",
            marginBottom: 16,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 6 },
            shadowOpacity: 0.28,
            shadowRadius: 8,
            elevation: 6,
          }}
          onPress={() => handlePress("driver")}
          activeOpacity={0.82}
        >
          <Text
            style={{
              color: "#111827",
              fontSize: 20,
              fontWeight: "800",
              letterSpacing: 0.3,
            }}
          >
            Driver
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            backgroundColor: "#22C55E",
            paddingVertical: 18,
            borderRadius: 16,
            alignItems: "center",
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 6 },
            shadowOpacity: 0.28,
            shadowRadius: 8,
            elevation: 6,
          }}
          onPress={() => handlePress("restaurant")}
          activeOpacity={0.82}
        >
          <Text
            style={{
              color: "white",
              fontSize: 20,
              fontWeight: "800",
              letterSpacing: 0.3,
            }}
          >
            Restaurant
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </SafeAreaView>
  );
}