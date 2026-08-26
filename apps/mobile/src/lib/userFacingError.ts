// Imported from "i18next" (not "../i18n") so this module stays free of the
// react-native / react-i18next bootstrap and can be used from any layer.
import i18n from "i18next";
import { routeDistanceLimitUserMessage } from "../../../../shared/routeDistanceLimits";

/** Resolves an i18n key, falling back to the English source when i18n is not ready yet. */
function tr(key: string, defaultValue: string): string {
  try {
    const value = i18n.t(key, { defaultValue });
    return typeof value === "string" && value.trim() ? value : defaultValue;
  } catch {
    return defaultValue;
  }
}

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
  /\brestaurant_profiles\b/i,
  /column .+ does not exist/i,
  /schema cache/i,
  /\[object Object\]/i,
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
  fallback = tr(
    "errors.fallback",
    "Something went wrong temporarily. Please try again.",
  ),
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

function code(key: string, defaultValue: string): string {
  return tr(`errors.codes.${key}`, defaultValue);
}

function pattern(key: string, defaultValue: string): string {
  return tr(`errors.patterns.${key}`, defaultValue);
}

const STRIPE_SETUP_REQUIRED_EN =
  "Complete your Stripe setup to enable payouts, then try again.";
const STRIPE_SECRET_LIVE_EN =
  "Stripe Connect is not ready on the server side. Contact MMD support.";
const STRIPE_PLATFORM_PROFILE_EN =
  "Stripe Connect is not activated yet for the MMD platform. Complete the Connect questionnaire in the Stripe Dashboard (Connect → Accounts → Overview), then try again.";
const DELIVERY_SHARE_EN =
  "The delivery configuration is temporarily unavailable. Try again later or contact support.";
const PROCESSING_ERROR_EN =
  "The payment could not be completed. Please try again in a few moments.";
const CARD_DECLINED_EN =
  "Your card was declined. Check your details or use another card.";
const INVALID_CREDENTIALS_EN =
  "Incorrect credentials. Check your email and password.";
const EMAIL_NOT_CONFIRMED_EN = "Confirm your email address before signing in.";
const PAYMENT_NOT_CONFIRMED_EN =
  "Payment was not completed. Please check your payment method and try again.";
const USER_ALREADY_REGISTERED_EN =
  "An account already exists with this email address.";

function mapKnownErrorCode(errorCode: string, message: string): string | null {
  switch (errorCode) {
    case "active_mission_in_progress":
      return code(
        "active_mission_in_progress",
        "Finish your current mission before changing this setting.",
      );
    case "documents_required":
      return code(
        "documents_required",
        "This transport mode requires your documents to be approved before it can be enabled.",
      );
    case "invalid_transport_mode":
      return code("invalid_transport_mode", "Invalid transport mode.");
    case "must_be_offline":
      return code(
        "must_be_offline",
        "Go offline to edit or delete a vehicle.",
      );
    case "active_ride_in_progress":
      return code(
        "active_ride_in_progress",
        "You cannot change vehicle during a ride.",
      );
    case "vehicle_not_active":
      return code(
        "vehicle_not_active",
        "This vehicle is not active or approved.",
      );
    case "vehicle_not_found":
      return code("vehicle_not_found", "Vehicle not found.");
    case "no_active_vehicle":
      return code(
        "no_active_vehicle",
        "Select an active, approved vehicle before going online.",
      );
    case "vehicle_pending_review":
      return code(
        "vehicle_pending_review",
        "Your vehicle is pending review. You will be able to go online once it is approved.",
      );
    case "vehicle_rejected":
      return code(
        "vehicle_rejected",
        "Your vehicle was rejected. Correct the information or add a new vehicle.",
      );
    case "vehicle_not_eligible":
      return code(
        "vehicle_not_eligible",
        "Your active vehicle is not eligible. Wait for admin approval or choose another vehicle.",
      );
    case "no_service_enabled":
      return code(
        "no_service_enabled",
        "Enable at least one service (Food, Package or Taxi) before going online.",
      );
    case "driver_not_approved":
      return code(
        "driver_not_approved",
        "Your driver account must be approved before you can go online.",
      );
    case "driver_suspended":
      return code("driver_suspended", "Your driver account is suspended.");
    case "driver_disabled":
      return code("driver_disabled", "Your driver account is disabled.");
    case "online_status_update_failed":
      return code(
        "online_status_update_failed",
        "Unable to change your status right now.",
      );
    case "route_unavailable":
      return code(
        "route_unavailable",
        "We could not calculate the exact route right now. Please check the addresses or try again.",
      );
    case "card_declined":
      return code("card_declined", CARD_DECLINED_EN);
    case "payment_intent_authentication_failure":
      return code(
        "payment_intent_authentication_failure",
        "Payment authentication failed. Try again or use another card.",
      );
    case "processing_error":
      return code("processing_error", PROCESSING_ERROR_EN);
    case "invalid_credentials":
    case "invalid_grant":
      return code("invalid_credentials", INVALID_CREDENTIALS_EN);
    case "email_not_confirmed":
      return code("email_not_confirmed", EMAIL_NOT_CONFIRMED_EN);
    case "user_already_registered":
      return code("user_already_registered", USER_ALREADY_REGISTERED_EN);
    case "weak_password":
      return code(
        "weak_password",
        "Password too weak. Use at least 8 characters.",
      );
    case "wallet_ledger_bridge_failed":
    case "payment_setup_failed":
      return code("payment_setup_failed", PROCESSING_ERROR_EN);
    case "Stripe payment not confirmed yet":
      return code("stripe_payment_not_confirmed", PAYMENT_NOT_CONFIRMED_EN);
    case "delivery_share_pct_invalid":
      return code("delivery_share_pct_invalid", DELIVERY_SHARE_EN);
    case "stripe_setup_required":
    case "Driver not onboarded":
      return code("stripe_setup_required", STRIPE_SETUP_REQUIRED_EN);
    case "stripe_secret_key_must_be_live":
      return code("stripe_secret_key_must_be_live", STRIPE_SECRET_LIVE_EN);
    case "stripe_account_retrieve_failed":
      return code(
        "stripe_account_retrieve_failed",
        "Unable to read your Stripe account. Reopen the payout setup.",
      );
    case "stripe_connect_platform_profile_incomplete":
      return code(
        "stripe_connect_platform_profile_incomplete",
        STRIPE_PLATFORM_PROFILE_EN,
      );
    case "profile_not_found":
      return code(
        "profile_not_found",
        "Your driver profile is incomplete. Reopen the app or contact support to finish your account, then try Enable again.",
      );
    case "stripe_connect_error":
      if (
        /complete your platform profile|answer the questionnaire|connect\/accounts\/overview/i.test(
          message,
        )
      ) {
        return code(
          "stripe_connect_platform_profile_incomplete",
          STRIPE_PLATFORM_PROFILE_EN,
        );
      }
      return code(
        "stripe_connect_error",
        "Unable to open the Stripe setup. Try again or contact support.",
      );
    case "already_cashed_out_today":
      return code(
        "already_cashed_out_today",
        "You have already requested a payout today. Try again tomorrow.",
      );
    case "below_minimum":
      return code(
        "below_minimum",
        "Your available balance is below the payout minimum.",
      );
    case "cashout_rate_limited":
      return code(
        "cashout_rate_limited",
        "Too many payout requests. Wait a few minutes then try again.",
      );
    case "Driver has no Stripe account":
      return code(
        "driver_no_stripe_account",
        "No Stripe Connect account found. Tap Enable payouts to get started.",
      );
    default:
      break;
  }

  if (/not onboarded|setup.?required|complete.?stripe/i.test(message)) {
    return pattern("notOnboarded", STRIPE_SETUP_REQUIRED_EN);
  }

  if (/stripe_secret_key_must_be_live|sk_live_/i.test(message)) {
    return pattern("stripeSecretLive", STRIPE_SECRET_LIVE_EN);
  }

  if (
    /driverSharePct\s*\+\s*platformSharePct/i.test(message) ||
    /delivery share pair incomplete/i.test(message) ||
    /must be provided together/i.test(message)
  ) {
    return pattern("deliveryShare", DELIVERY_SHARE_EN);
  }

  if (/invalid login credentials/i.test(message)) {
    return pattern("invalidCredentials", INVALID_CREDENTIALS_EN);
  }

  if (/email not confirmed/i.test(message)) {
    return pattern("emailNotConfirmed", EMAIL_NOT_CONFIRMED_EN);
  }

  if (/payment not confirmed yet/i.test(message)) {
    return pattern("paymentNotConfirmed", PAYMENT_NOT_CONFIRMED_EN);
  }

  if (/user already registered/i.test(message)) {
    return pattern("userAlreadyRegistered", USER_ALREADY_REGISTERED_EN);
  }

  if (/Canc/i.test(message) || errorCode === "Canceled") {
    return pattern("paymentCanceled", "Payment canceled.");
  }

  if (/Une erreur de traitement est survenue/i.test(message)) {
    return pattern("processingError", PROCESSING_ERROR_EN);
  }

  if (/card was declined/i.test(message)) {
    return pattern("cardDeclined", CARD_DECLINED_EN);
  }

  if (/network request failed/i.test(message)) {
    return pattern(
      "networkFailed",
      "Unstable connection. Check your network and try again.",
    );
  }

  if (message === "taxi_distance_too_far" || message === "delivery_distance_too_far") {
    const text = routeDistanceLimitUserMessage(message, undefined, "en");
    if (text) {
      return pattern(
        message === "taxi_distance_too_far" ? "taxiDistanceTooFar" : "deliveryDistanceTooFar",
        text,
      );
    }
  }

  if (message === "distance_too_far") {
    return pattern("distanceTooFar", "The distance is too long for this ride.");
  }

  return null;
}

export function logTechnicalError(scope: string, error: unknown, metadata?: Record<string, unknown>) {
  try {
    const { isExpectedUnpaidPaymentSentryNoise } =
      require("./taxiPaymentAbandonFlow") as {
        isExpectedUnpaidPaymentSentryNoise: (
          error: unknown,
          metadata?: Record<string, unknown> | null,
        ) => boolean;
      };
    if (isExpectedUnpaidPaymentSentryNoise(error, metadata ?? null)) {
      console.log(`[${scope}] expected unpaid payment (not sent to Sentry)`, {
        status: metadata?.status,
      });
      return;
    }
  } catch {
    // fall through to normal logging if helper unavailable
  }

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
