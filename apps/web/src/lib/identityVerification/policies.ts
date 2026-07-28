import type { SupabaseClient } from "@supabase/supabase-js";
import type { IdentityProviderId, IdentitySubjectType } from "./types";
import type { IdentityVerificationPolicy } from "./types";
import { stripeIdentityProvider } from "./providers/stripeIdentity";
import type { IdentityProvider } from "./provider";

const providers = new Map<string, IdentityProvider>([
  [stripeIdentityProvider.id, stripeIdentityProvider],
]);

export function registerIdentityProvider(provider: IdentityProvider): void {
  providers.set(provider.id, provider);
}

export function getIdentityProvider(
  providerId: IdentityProviderId | string
): IdentityProvider {
  const provider = providers.get(providerId);
  if (!provider) {
    throw new Error(`identity_provider_unavailable:${providerId}`);
  }
  return provider;
}

export async function loadIdentityPolicy(
  supabase: SupabaseClient,
  subjectType: IdentitySubjectType,
  featureKey = "default"
): Promise<IdentityVerificationPolicy | null> {
  const { data, error } = await supabase
    .from("identity_verification_policies")
    .select("*")
    .eq("subject_type", subjectType)
    .eq("feature_key", featureKey)
    .maybeSingle();

  if (error) throw error;
  return (data as IdentityVerificationPolicy | null) ?? null;
}

export async function resolveConnectPersonBridge(
  supabase: SupabaseClient,
  subjectUserId: string,
  subjectType: IdentitySubjectType
): Promise<{ accountId: string | null; personId: string | null }> {
  if (subjectType === "driver") {
    const { data } = await supabase
      .from("driver_profiles")
      .select("stripe_account_id")
      .eq("user_id", subjectUserId)
      .maybeSingle();
    return {
      accountId: data?.stripe_account_id ? String(data.stripe_account_id) : null,
      personId: null,
    };
  }

  if (subjectType === "restaurant") {
    const { data } = await supabase
      .from("restaurant_profiles")
      .select("stripe_account_id")
      .eq("user_id", subjectUserId)
      .maybeSingle();
    return {
      accountId: data?.stripe_account_id ? String(data.stripe_account_id) : null,
      personId: null,
    };
  }

  if (subjectType === "seller") {
    const { data } = await supabase
      .from("sellers")
      .select("stripe_account_id")
      .eq("user_id", subjectUserId)
      .maybeSingle();
    return {
      accountId: data?.stripe_account_id ? String(data.stripe_account_id) : null,
      personId: null,
    };
  }

  return { accountId: null, personId: null };
}
