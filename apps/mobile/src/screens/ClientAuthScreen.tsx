import React, { useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StatusBar,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { supabase } from "../lib/supabase";

type Nav = NativeStackNavigationProp<RootStackParamList, "ClientAuth">;

export function ClientAuthScreen() {
  const navigation = useNavigation<Nav>();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      Alert.alert("Champs manquants", "Email et mot de passe sont obligatoires.");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        console.error(error);
        throw new Error(error.message || "Échec de la connexion.");
      }

      if (!data.session) {
        throw new Error("Session non créée. Réessayez.");
      }

      Alert.alert("Connecté", "Connexion réussie.", [
        {
          text: "OK",
          onPress: () => {
            navigation.reset({
              index: 0,
              routes: [{ name: "Home" }],
            });
          },
        },
      ]);
    } catch (e: any) {
      console.error(e);
      Alert.alert("Erreur", e?.message ?? "Impossible de se connecter.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView
        style={{ flex: 1, padding: 24, justifyContent: "center" }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View>
          <Text
            style={{
              fontSize: 26,
              fontWeight: "700",
              color: "white",
              marginBottom: 12,
            }}
          >
            Connexion client
          </Text>
          <Text
            style={{
              fontSize: 14,
              color: "#9CA3AF",
              marginBottom: 24,
            }}
          >
            Connecte-toi avec ton compte client MMD (même email que sur le web).
          </Text>

          <Text style={{ color: "#E5E7EB", marginBottom: 8 }}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="client@example.com"
            placeholderTextColor="#6B7280"
            autoCapitalize="none"
            keyboardType="email-address"
            style={{
              borderWidth: 1,
              borderColor: "#374151",
              borderRadius: 8,
              paddingHorizontal: 14,
              paddingVertical: 10,
              color: "white",
              marginBottom: 16,
            }}
          />

          <Text style={{ color: "#E5E7EB", marginBottom: 8 }}>Mot de passe</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Mot de passe"
            placeholderTextColor="#6B7280"
            secureTextEntry
            style={{
              borderWidth: 1,
              borderColor: "#374151",
              borderRadius: 8,
              paddingHorizontal: 14,
              paddingVertical: 10,
              color: "white",
              marginBottom: 24,
            }}
          />

          <TouchableOpacity
            onPress={handleLogin}
            disabled={loading}
            style={{
              backgroundColor: "#3B82F6",
              paddingVertical: 14,
              borderRadius: 8,
              alignItems: "center",
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
                Se connecter
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
