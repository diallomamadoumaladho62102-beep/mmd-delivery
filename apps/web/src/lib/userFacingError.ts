import { captureProductionException } from "@/lib/sentryCapture";

const TECHNICAL_PATTERNS: RegExp[] = [
  /unrecognized format\(\)/i,
  /postgres/i,
  /supabase/i,
  /pgrst/i,
  /rpc/i,
  /mapbox directions failed/i,
  /mapbox geocoding failed/i,
  /http \d{3}/i,
  /\b422\b/,
  /\b500\b/,
  /\bdriver_profiles\b/i,
  /\bdriver_vehicles\b/i,
  /type specifier/i,
  /violates row-level security/i,
  /permission denied/i,
  /payment_intent/i,
  /wallet_ledger/i,
  /JWT expired/i,
  /invalid jwt/i,
  /fetch failed/i,
];

export function isTechnicalErrorMessage(message: string): boolean {
  const text = String(message ?? "").trim();
  if (!text) return false;
  return TECHNICAL_PATTERNS.some((pattern) => pattern.test(text));
}

export function toUserFacingError(
  error: unknown,
  fallback = "Une action temporairement impossible s'est produite. Veuillez réessayer.",
): string {
  if (error == null) return fallback;

  const record =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : null;

  const code = String(record?.code ?? record?.error ?? "").trim();
  const rawMessage = String(
    record?.message ?? (error instanceof Error ? error.message : error) ?? "",
  ).trim();

  const mapped = mapKnownErrorCode(code, rawMessage);
  if (mapped) return mapped;

  if (!rawMessage || isTechnicalErrorMessage(rawMessage)) {
    return fallback;
  }

  return rawMessage;
}

function mapKnownErrorCode(code: string, message: string): string | null {
  switch (code) {
    case "active_mission_in_progress":
      return "Terminez votre mission en cours avant de modifier ce paramètre.";
    case "documents_required":
      return "Ce mode de transport nécessite une validation de vos documents avant d'être activé.";
    case "invalid_transport_mode":
      return "Mode de transport invalide.";
    case "route_unavailable":
      return "Nous n'avons pas pu calculer l'itinéraire exact pour le moment. Veuillez vérifier les adresses ou réessayer.";
    case "card_declined":
      return "Votre carte a été refusée. Vérifiez vos informations ou utilisez une autre carte.";
    case "payment_intent_authentication_failure":
      return "L'authentification du paiement a échoué. Réessayez ou utilisez une autre carte.";
    case "processing_error":
      return "Le paiement n'a pas pu être finalisé. Réessayez dans quelques instants.";
    case "invalid_credentials":
    case "invalid_grant":
      return "Identifiants incorrects. Vérifiez votre email et mot de passe.";
    case "email_not_confirmed":
      return "Confirmez votre adresse email avant de vous connecter.";
    case "user_already_registered":
      return "Un compte existe déjà avec cette adresse email.";
    case "wallet_ledger_bridge_failed":
    case "payment_setup_failed":
      return "Le paiement n'a pas pu être finalisé. Réessayez dans quelques instants.";
    default:
      break;
  }

  if (/invalid login credentials/i.test(message)) {
    return "Identifiants incorrects. Vérifiez votre email et mot de passe.";
  }

  if (/Canc/i.test(message) || code === "Canceled") {
    return "Paiement annulé.";
  }

  if (/Une erreur de traitement est survenue/i.test(message)) {
    return "Le paiement n'a pas pu être finalisé. Réessayez dans quelques instants.";
  }

  if (/card was declined/i.test(message)) {
    return "Votre carte a été refusée. Vérifiez vos informations ou utilisez une autre carte.";
  }

  if (/network request failed/i.test(message)) {
    return "Connexion instable. Vérifiez votre réseau et réessayez.";
  }

  if (message === "distance_too_far") {
    return "La distance est trop importante pour cette course.";
  }

  return null;
}

export function logTechnicalError(scope: string, error: unknown, metadata?: Record<string, unknown>) {
  console.error(`[${scope}]`, error, metadata ?? {});
  captureProductionException(scope, error, metadata);
}
