import React, { useCallback, useEffect, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import * as Linking from "expo-linking";
import { useNavigation } from "@react-navigation/native";
import { supabase } from "../lib/supabase";

function getUrlParams(url: string) {
  const params: Record<string, string> = {};

  const [, hash = ""] = url.split("#");
  const [, query = ""] = url.split("?");

  const raw = [hash, query].filter(Boolean).join("&");

  raw.split("&").forEach((part) => {
    const [key, value] = part.split("=");
    if (key && value) {
      params[decodeURIComponent(key)] = decodeURIComponent(value);
    }
  });

  return params;
}

export default function ResetPasswordScreen() {
  const navigation = useNavigation<any>();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  const prepareRecoverySession = useCallback(async (url: string | null) => {
    try {
      if (!url) return;

      console.log("RESET PASSWORD URL =", url);

      const params = getUrlParams(url);
      const accessToken = params.access_token;
      const refreshToken = params.refresh_token;

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (error) {
          console.log("setSession recovery error:", error.message);
          Alert.alert("Erreur", "Lien invalide ou expiré. Renvoie un nouveau lien.");
        }
      }
    } catch (e) {
      console.log("prepareRecoverySession error:", e);
      Alert.alert("Erreur", "Impossible de préparer la réinitialisation.");
    } finally {
      setCheckingSession(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;

    Linking.getInitialURL()
      .then((url) => {
        if (!alive) return;
        void prepareRecoverySession(url);
      })
      .catch((e) => {
        console.log("getInitialURL reset error:", e);
        setCheckingSession(false);
      });

    const sub = Linking.addEventListener("url", (event) => {
      void prepareRecoverySession(event.url);
    });

    return () => {
      alive = false;
      sub.remove();
    };
  }, [prepareRecoverySession]);

  const onUpdatePassword = useCallback(async () => {
    if (loading) return;

    const cleanedPassword = password.trim();
    const cleanedConfirmPassword = confirmPassword.trim();

    if (cleanedPassword.length < 6) {
      Alert.alert("Erreur", "Mot de passe trop court. Minimum 6 caractères.");
      return;
    }

    if (cleanedPassword !== cleanedConfirmPassword) {
      Alert.alert("Erreur", "Les mots de passe ne correspondent pas.");
      return;
    }

    try {
      setLoading(true);

      const { error } = await supabase.auth.updateUser({
        password: cleanedPassword,
      });

      if (error) {
        Alert.alert("Erreur", error.message);
        return;
      }

      Alert.alert("Succès", "Ton mot de passe a été modifié.", [
        {
          text: "OK",
          onPress: async () => {
            await supabase.auth.signOut();
            navigation.reset({
              index: 0,
              routes: [{ name: "RoleSelect" }],
            });
          },
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [password, confirmPassword, loading, navigation]);

  if (checkingSession) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: "#020617",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator color="white" />
        <Text style={{ color: "#9CA3AF", marginTop: 12, fontWeight: "700" }}>
          Préparation du lien...
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <View style={{ padding: 16, marginTop: 40 }}>
          <Text style={{ color: "white", fontSize: 28, fontWeight: "900" }}>
            Nouveau mot de passe
          </Text>

          <Text
            style={{
              color: "#9CA3AF",
              marginTop: 10,
              fontSize: 15,
              lineHeight: 22,
              fontWeight: "700",
            }}
          >
            Entre ton nouveau mot de passe pour récupérer ton compte MMD Delivery.
          </Text>

          <View style={{ marginTop: 24 }}>
            <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
              Mot de passe
            </Text>
            <TextInput
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              placeholder="Nouveau mot de passe"
              placeholderTextColor="#475569"
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                marginTop: 8,
                padding: 14,
                borderRadius: 14,
                backgroundColor: "#0B1220",
                color: "white",
                borderWidth: 1,
                borderColor: "#111827",
              }}
            />
          </View>

          <View style={{ marginTop: 16 }}>
            <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
              Confirmer le mot de passe
            </Text>
            <TextInput
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirme le mot de passe"
              placeholderTextColor="#475569"
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                marginTop: 8,
                padding: 14,
                borderRadius: 14,
                backgroundColor: "#0B1220",
                color: "white",
                borderWidth: 1,
                borderColor: "#111827",
              }}
            />
          </View>

          <TouchableOpacity
            onPress={() => void onUpdatePassword()}
            disabled={loading}
            activeOpacity={0.85}
            style={{
              marginTop: 26,
              backgroundColor: loading ? "#111827" : "#2563EB",
              padding: 15,
              borderRadius: 14,
              alignItems: "center",
            }}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={{ color: "white", fontWeight: "900", fontSize: 16 }}>
                Mettre à jour
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() =>
              navigation.reset({
                index: 0,
                routes: [{ name: "RoleSelect" }],
              })
            }
            style={{ marginTop: 18, alignItems: "center" }}
          >
            <Text style={{ color: "#93C5FD", fontWeight: "900" }}>
              Retour
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}