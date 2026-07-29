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
  /Request failed/i,
  /payment_intent/i,
  /clientSecret manquant/i,
  /wallet_ledger/i,
  /JWT expired/i,
  /invalid jwt/i,
  /network request failed/i,
  /fetch failed/i,
  /edge function/i,
  /functions\.invoke/i,
  /driverSharePct\s*\+\s*platformSharePct/i,
  /delivery share pair incomplete/i,
  /must be provided together/i,
  /delivery_share_pct_invalid/i,
  /delivery_fee_abnormal/i,
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
    case "must_be_offline":
      return "Passez hors ligne pour modifier ou supprimer un véhicule.";
    case "active_ride_in_progress":
      return "Impossible de changer de véhicule pendant une course.";
    case "vehicle_not_active":
      return "Ce véhicule n'est pas actif ou approuvé.";
    case "vehicle_not_found":
      return "Véhicule introuvable.";
    case "no_active_vehicle":
      return "Sélectionnez un véhicule actif et approuvé avant de passer en ligne.";
    case "vehicle_pending_review":
      return "Votre véhicule est en attente de validation. Vous pourrez passer en ligne après approbation.";
    case "vehicle_rejected":
      return "Votre véhicule a été refusé. Corrigez les informations ou ajoutez un nouveau véhicule.";
    case "vehicle_not_eligible":
      return "Votre véhicule actif n'est pas éligible. Attendez la validation admin ou choisissez un autre véhicule.";
    case "no_service_enabled":
      return "Activez au moins un service (Food, Colis ou Taxi) avant de passer en ligne.";
    case "driver_not_approved":
      return "Votre compte chauffeur doit être approuvé avant de passer en ligne.";
    case "driver_suspended":
      return "Votre compte chauffeur est suspendu.";
    case "driver_disabled":
      return "Votre compte chauffeur est désactivé.";
    case "online_status_update_failed":
      return "Impossible de changer le statut pour le moment.";
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
    case "weak_password":
      return "Mot de passe trop faible. Utilisez au moins 8 caractères.";
    case "wallet_ledger_bridge_failed":
    case "payment_setup_failed":
      return "Le paiement n'a pas pu être finalisé. Réessayez dans quelques instants.";
    case "delivery_share_pct_invalid":
      return "La configuration de livraison est temporairement indisponible. Réessayez plus tard ou contactez le support.";
    case "stripe_setup_required":
    case "Driver not onboarded":
      return "Complétez la configuration Stripe pour activer les virements, puis réessayez.";
    case "stripe_secret_key_must_be_live":
      return "La configuration Stripe Connect n'est pas prête côté serveur. Contactez le support MMD.";
    case "stripe_account_retrieve_failed":
      return "Impossible de lire votre compte Stripe. Rouvrez la configuration des virements.";
    case "stripe_connect_platform_profile_incomplete":
      return "Stripe Connect n'est pas encore activé pour la plateforme MMD. Complétez le questionnaire Connect dans le Dashboard Stripe (Connect → Accounts → Overview), puis réessayez.";
    case "profile_not_found":
      return "Votre profil chauffeur est incomplet. Rouvrez l'application ou contactez le support pour finaliser votre compte, puis réessayez Enable.";
    case "stripe_connect_error":
      if (
        /complete your platform profile|answer the questionnaire|connect\/accounts\/overview/i.test(
          message,
        )
      ) {
        return "Stripe Connect n'est pas encore activé pour la plateforme MMD. Complétez le questionnaire Connect dans le Dashboard Stripe (Connect → Accounts → Overview), puis réessayez.";
      }
      return "Impossible d'ouvrir la configuration Stripe. Réessayez ou contactez le support.";
    case "already_cashed_out_today":
      return "Vous avez déjà demandé un retrait aujourd'hui. Réessayez demain.";
    case "below_minimum":
      return "Le solde disponible est inférieur au minimum de retrait.";
    case "cashout_rate_limited":
      return "Trop de demandes de retrait. Attendez quelques minutes puis réessayez.";
    case "Driver has no Stripe account":
      return "Aucun compte Stripe Connect trouvé. Appuyez sur Activer les virements pour commencer.";
    default:
      break;
  }

  if (/not onboarded|setup.?required|complete.?stripe/i.test(message)) {
    return "Complétez la configuration Stripe pour activer les virements, puis réessayez.";
  }

  if (/stripe_secret_key_must_be_live|sk_live_/i.test(message)) {
    return "La configuration Stripe Connect n'est pas prête côté serveur. Contactez le support MMD.";
  }

  if (
    /driverSharePct\s*\+\s*platformSharePct/i.test(message) ||
    /delivery share pair incomplete/i.test(message) ||
    /must be provided together/i.test(message)
  ) {
    return "La configuration de livraison est temporairement indisponible. Réessayez plus tard ou contactez le support.";
  }

  if (/invalid login credentials/i.test(message)) {
    return "Identifiants incorrects. Vérifiez votre email et mot de passe.";
  }

  if (/email not confirmed/i.test(message)) {
    return "Confirmez votre adresse email avant de vous connecter.";
  }

  if (/user already registered/i.test(message)) {
    return "Un compte existe déjà avec cette adresse email.";
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
  try {
    // Lazy require avoids circular init with sentry bootstrap.
    const { captureMobileException } = require("./sentry") as {
      captureMobileException: (
        scope: string,
        error: unknown,
        extra?: Record<string, unknown>
      ) => void;
    };
    captureMobileException(scope, error, metadata);
  } catch {
    // never throw from telemetry
  }
}
