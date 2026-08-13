import * as WebBrowser from "expo-web-browser";
import { Alert, Linking } from "react-native";
import {
  createIdentitySession,
  fetchIdentityStatus,
  type IdentitySubjectType,
} from "./identityVerificationApi";

/**
 * Starts Stripe Identity via the official hosted Verification Session URL.
 * Documents stay on Stripe; MMD only receives webhook status updates.
 *
 * Native `@stripe/stripe-identity-react-native` can replace this opener later
 * using the same API response (`ephemeralKeySecret` + `sessionId`) without
 * changing backend contracts.
 */
export async function startStripeIdentityVerification(params: {
  subjectType: IdentitySubjectType;
  featureKey?: string;
  returnUrl?: string;
}): Promise<{ ok: boolean; status?: string; error?: string; message?: string }> {
  const status = await fetchIdentityStatus(
    params.subjectType,
    params.featureKey ?? "default"
  );

  if (status.ok && status.verified) {
    return { ok: true, status: "verified" };
  }

  const session = await createIdentitySession({
    subjectType: params.subjectType,
    featureKey: params.featureKey,
    returnUrl: params.returnUrl ?? "mmddelivery://identity/return",
  });

  if (!session.ok) {
    return {
      ok: false,
      error: session.error,
      message: session.message ?? "Unable to start identity verification.",
    };
  }

  if (!session.url) {
    return {
      ok: false,
      error: "missing_session_url",
      message: "Stripe Identity session URL missing.",
    };
  }

  try {
    await WebBrowser.openAuthSessionAsync(
      session.url,
      params.returnUrl ?? "mmddelivery://identity/return"
    );
  } catch {
    await Linking.openURL(session.url);
  }

  const refreshed = await fetchIdentityStatus(
    params.subjectType,
    params.featureKey ?? "default"
  );

  return {
    ok: true,
    status: refreshed.status,
    message:
      refreshed.verified
        ? "Identity verified."
        : "Verification submitted. Final status arrives via Stripe webhooks.",
  };
}

export async function promptStripeIdentityIfRequired(
  subjectType: IdentitySubjectType
): Promise<boolean> {
  const status = await fetchIdentityStatus(subjectType);
  // API failure must not invent a Stripe requirement — server assertDriverCanGoOnline
  // / is_identity_verified remain authoritative when the policy is actually required.
  if (!status.ok) return true;
  if (!status.required || status.verified || status.canProceed) return true;

  return await new Promise((resolve) => {
    Alert.alert(
      "Identity verification required",
      "Complete Stripe Identity verification to continue. Documents are processed by Stripe only.",
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        {
          text: "Verify",
          onPress: () => {
            void startStripeIdentityVerification({ subjectType }).then((result) => {
              resolve(Boolean(result.ok));
            });
          },
        },
      ]
    );
  });
}
