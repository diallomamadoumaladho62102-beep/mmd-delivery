import React from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  Image,
  Alert,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";

import { supabase } from "../lib/supabase";
import { setSelectedRole } from "../lib/authRole";
import { useTranslation } from "react-i18next";

type RoleSelectNav = NativeStackNavigationProp<RootStackParamList, "RoleSelect">;

type PublicRole = "client" | "driver" | "restaurant";
type ProfileRole = PublicRole | "admin" | null;
type DriverStatus = "pending" | "approved" | "rejected" | "incomplete" | "suspended" | null;

function normalizeProfileRole(value: unknown): ProfileRole {
  const role = String(value ?? "").trim().toLowerCase();

  if (role === "client") return "client";
  if (role === "driver" || role === "livreur" || role === "chauffeur") return "driver";
  if (role === "restaurant") return "restaurant";
  if (role === "admin" || role === "support") return "admin";

  return null;
}

export function RoleSelectScreen() {
  const navigation = useNavigation<RoleSelectNav>();
  const { t } = useTranslation();

  async function routeLoggedInUser(selectedRole: PublicRole, userId: string) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) {
      console.log("RoleSelect profile check error:", profileError);
      Alert.alert(
        t("common.error", "Erreur"),
        t(
          "roleSelect.errors.profileCheckFailed",
          "Impossible de vérifier ton profil. Réessaie."
        )
      );
      return;
    }

    const realRole = normalizeProfileRole((profile as any)?.role);

    if (realRole && realRole !== selectedRole) {
      Alert.alert(
        t("roleSelect.wrongRoleTitle", "Compte déjà connecté"),
        t(
          "roleSelect.wrongRoleBody",
          "Ce compte est enregistré comme {{role}}. Déconnecte-toi si tu veux utiliser un autre rôle.",
          { role: realRole }
        )
      );

      if (realRole === "client") {
        navigation.navigate("ClientHome");
        return;
      }

      if (realRole === "driver") {
        const { data: driverProfile } = await supabase
          .from("driver_profiles")
          .select("status")
          .eq("user_id", userId)
          .maybeSingle();

        const status = normalizeDriverStatus((driverProfile as any)?.status);

        if (status === "approved") {
          navigation.navigate("DriverTabs");
          return;
        }

        navigation.navigate("DriverOnboarding");
        return;
      }

      if (realRole === "restaurant") {
        navigation.navigate("RestaurantGate");
        return;
      }

      return;
    }

    const roleToUse = realRole ?? selectedRole;

    if (roleToUse === "client") {
      navigation.navigate("ClientHome");
      return;
    }

    if (roleToUse === "driver") {
      const { data: driverProfile, error: driverError } = await supabase
        .from("driver_profiles")
        .select("status")
        .eq("user_id", userId)
        .maybeSingle();

      if (driverError) {
        console.log("RoleSelect driver profile check error:", driverError);
        navigation.navigate("DriverOnboarding");
        return;
      }

      const status = normalizeDriverStatus((driverProfile as any)?.status);

      if (status === "approved") {
        navigation.navigate("DriverTabs");
        return;
      }

      if (status === "suspended") {
        Alert.alert(
          t("roleSelect.driverSuspendedTitle", "Compte suspendu"),
          t(
            "roleSelect.driverSuspendedBody",
            "Ton compte chauffeur est suspendu. Contacte le support MMD Delivery."
          )
        );
        await supabase.auth.signOut();
        navigation.navigate("RoleSelect");
        return;
      }

      navigation.navigate("DriverOnboarding");
      return;
    }

    if (roleToUse === "restaurant") {
      navigation.navigate("RestaurantGate");
      return;
    }

    Alert.alert(
      t("roleSelect.adminTitle", "Admin"),
      t(
        "roleSelect.adminBody",
        "Ce compte est un compte admin. Utilise l’interface admin prévue pour gérer MMD Delivery."
      )
    );
  }

  async function handlePress(role: PublicRole) {
    try {
      await setSelectedRole(role);

      const { data, error } = await supabase.auth.getSession();

      if (error) {
        console.log("RoleSelect session error:", error);
      }

      const session = data.session ?? null;

      if (!session?.user?.id) {
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

      await routeLoggedInUser(role, session.user.id);
    } catch (e: any) {
      console.log("RoleSelect handlePress error:", e);

      Alert.alert(
        t("common.error", "Erreur"),
        e?.message ??
          t(
            "roleSelect.errors.openRoleFailed",
            "Impossible d’ouvrir ce rôle pour le moment."
          )
      );
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <StatusBar barStyle="light-content" />

      <View
        style={{
          flex: 1,
          paddingHorizontal: 24,
          paddingTop: 24,
          paddingBottom: 24,
          justifyContent: "center",
        }}
      >
        <View
          style={{
            alignItems: "center",
            marginBottom: 36,
          }}
        >
          <Image
            source={require("../../assets/icon.png")}
            style={{
              width: 96,
              height: 96,
              marginBottom: 16,
              borderRadius: 24,
            }}
            resizeMode="contain"
          />

          <Text
            style={{
              fontSize: 28,
              fontWeight: "800",
              color: "white",
              marginBottom: 8,
            }}
          >
            MMD Delivery
          </Text>

          <Text
            style={{
              fontSize: 15,
              color: "#CBD5E1",
              textAlign: "center",
              marginBottom: 6,
            }}
          >
            We deliver with heart ❤️
          </Text>

          <Text
            style={{
              fontSize: 14,
              color: "#94A3B8",
              textAlign: "center",
            }}
          >
            Fast, simple and reliable 🚀
          </Text>
        </View>

        <View
          style={{
            backgroundColor: "#0F172A",
            borderRadius: 20,
            padding: 20,
            borderWidth: 1,
            borderColor: "#1E293B",
          }}
        >
          <Text
            style={{
              fontSize: 24,
              fontWeight: "700",
              color: "white",
              marginBottom: 12,
              textAlign: "center",
            }}
          >
            {t("roleSelect.title", "Choose your mode")}
          </Text>

          <Text
            style={{
              fontSize: 14,
              color: "#9CA3AF",
              marginBottom: 28,
              textAlign: "center",
              lineHeight: 20,
            }}
          >
            {t(
              "roleSelect.subtitle",
              "Choose a role to access the corresponding interface."
            )}
          </Text>

          <TouchableOpacity
            style={{
              backgroundColor: "#EF4444",
              paddingVertical: 15,
              borderRadius: 14,
              alignItems: "center",
              marginBottom: 14,
              shadowColor: "#000",
              shadowOpacity: 0.2,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 3 },
              elevation: 3,
            }}
            onPress={() => {
              void handlePress("client");
            }}
            activeOpacity={0.85}
          >
            <Text style={{ color: "white", fontSize: 16, fontWeight: "700" }}>
              {t("roleSelect.roles.client", "Client")}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={{
              backgroundColor: "#0EA5E9",
              paddingVertical: 15,
              borderRadius: 14,
              alignItems: "center",
              marginBottom: 14,
              shadowColor: "#000",
              shadowOpacity: 0.2,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 3 },
              elevation: 3,
            }}
            onPress={() => {
              void handlePress("driver");
            }}
            activeOpacity={0.85}
          >
            <Text style={{ color: "white", fontSize: 16, fontWeight: "700" }}>
              {t("roleSelect.roles.driver", "Driver")}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={{
              backgroundColor: "#22C55E",
              paddingVertical: 15,
              borderRadius: 14,
              alignItems: "center",
              shadowColor: "#000",
              shadowOpacity: 0.2,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 3 },
              elevation: 3,
            }}
            onPress={() => {
              void handlePress("restaurant");
            }}
            activeOpacity={0.85}
          >
            <Text style={{ color: "white", fontSize: 16, fontWeight: "700" }}>
              {t("roleSelect.roles.restaurant", "Restaurant")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

function normalizeDriverStatus(value: unknown): DriverStatus {
  const status = String(value ?? "").trim().toLowerCase();

  if (
    status === "pending" ||
    status === "approved" ||
    status === "rejected" ||
    status === "incomplete" ||
    status === "suspended"
  ) {
    return status;
  }

  return null;
}
