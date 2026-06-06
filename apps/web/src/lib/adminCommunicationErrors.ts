const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CommunicationErrorCode =
  | "invalid_user_id"
  | "user_not_found"
  | "missing_expo_token"
  | "missing_push_config"
  | "missing_phone"
  | "missing_email"
  | "missing_message"
  | "invalid_channel"
  | "unauthorized"
  | "provider_error";

export function isSupabaseUserId(value: string): boolean {
  return UUID_RE.test(value.trim());
}

export function communicationErrorMessage(code: CommunicationErrorCode): string {
  switch (code) {
    case "invalid_user_id":
      return "User ID invalide — utilise un UUID Supabase (pas un numéro de téléphone).";
    case "user_not_found":
      return "Utilisateur introuvable.";
    case "missing_expo_token":
      return "Aucun expo_push_token enregistré pour cet utilisateur.";
    case "missing_push_config":
      return "Push non configuré (PUSH_API_KEY manquant sur le serveur).";
    case "missing_phone":
      return "Numéro de téléphone manquant pour cet utilisateur.";
    case "missing_email":
      return "Adresse email manquante pour cet utilisateur.";
    case "missing_message":
      return "Message requis.";
    case "invalid_channel":
      return "Canal invalide (push, sms ou email).";
    case "unauthorized":
      return "Non autorisé.";
    case "provider_error":
      return "Erreur du fournisseur d'envoi.";
    default:
      return "Échec envoi.";
  }
}

export function mapProviderFailure(
  response: Record<string, unknown>
): CommunicationErrorCode {
  const error = String(response.error ?? "").toLowerCase();

  if (error.includes("push_api_key") || error.includes("not configured")) {
    return "missing_push_config";
  }
  if (response.reason === "no_tokens") {
    return "missing_expo_token";
  }
  if (error.includes("unauthorized")) {
    return "unauthorized";
  }
  if (error.includes("twilio") || error.includes("resend")) {
    return "provider_error";
  }

  return "provider_error";
}
