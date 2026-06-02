import React from "react";
import { View, Text, ActivityIndicator, TouchableOpacity } from "react-native";

type Props = {
  variant:
    | "loading"
    | "missing_token"
    | "missing_order"
    | "missing_coords"
    | "permission_denied"
    | "route_error";
  message?: string;
  onGoBack?: () => void;
  onRetry?: () => void;
};

export function DriverMapFallbackStates({
  variant,
  message,
  onGoBack,
  onRetry,
}: Props) {
  const content = getContent(variant, message);

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 24,
        backgroundColor: "#020617",
      }}
    >
      {variant === "loading" && <ActivityIndicator size="large" color="#60A5FA" />}
      <Text
        style={{
          color: "#FFFFFF",
          fontSize: 18,
          fontWeight: "900",
          marginTop: variant === "loading" ? 16 : 0,
          textAlign: "center",
        }}
      >
        {content.title}
      </Text>
      <Text
        style={{
          color: "#94A3B8",
          fontSize: 13,
          marginTop: 10,
          textAlign: "center",
          lineHeight: 20,
        }}
      >
        {content.body}
      </Text>

      <View style={{ flexDirection: "row", marginTop: 18 }}>
        {onGoBack && (
          <TouchableOpacity
            onPress={onGoBack}
            style={buttonStyle("rgba(15,23,42,0.95)")}
          >
            <Text style={{ color: "#E2E8F0", fontWeight: "800" }}>Retour</Text>
          </TouchableOpacity>
        )}
        {onRetry && (
          <TouchableOpacity
            onPress={onRetry}
            style={buttonStyle("#2563EB")}
          >
            <Text style={{ color: "#FFFFFF", fontWeight: "800" }}>Réessayer</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function buttonStyle(backgroundColor: string) {
  return {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor,
    marginHorizontal: 6,
  };
}

function getContent(variant: Props["variant"], message?: string) {
  switch (variant) {
    case "loading":
      return {
        title: "Préparation de la navigation",
        body: "Localisation sécurisée en cours…",
      };
    case "missing_token":
      return {
        title: "Navigation indisponible",
        body:
          "Le token Mapbox est absent. Contacte le support MMD avant d'utiliser la carte chauffeur.",
      };
    case "missing_order":
      return {
        title: "Course introuvable",
        body: message || "Impossible de charger cette course.",
      };
    case "missing_coords":
      return {
        title: "Coordonnées GPS manquantes",
        body:
          "Cette course n'a pas encore de coordonnées valides. Retourne aux détails de commande.",
      };
    case "permission_denied":
      return {
        title: "Permission GPS refusée",
        body: "Active la localisation pour utiliser la navigation MMD.",
      };
    case "route_error":
      return {
        title: "Route indisponible",
        body:
          message ||
          "Impossible de calculer l'itinéraire pour le moment. Tu peux réessayer ou ouvrir une app externe depuis les détails.",
      };
    default:
      return { title: "Erreur", body: message || "Une erreur est survenue." };
  }
}
