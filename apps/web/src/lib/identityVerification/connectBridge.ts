import type { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";
import type { IdentitySubjectType } from "./types";

/**
 * Resolves the Connect account for a subject and, when possible, a Person id
 * so Stripe Identity can attach via `related_person` (same Stripe account).
 *
 * Does not create a second Connect or Identity account — only links to the
 * existing platform Connect account for that subject.
 */
export async function resolveConnectPersonBridge(
  supabase: SupabaseClient,
  subjectUserId: string,
  subjectType: IdentitySubjectType
): Promise<{ accountId: string | null; personId: string | null }> {
  const accountId = await loadConnectAccountId(
    supabase,
    subjectUserId,
    subjectType
  );
  if (!accountId) {
    return { accountId: null, personId: null };
  }

  const personId = await resolveRepresentativePersonId(accountId);
  return { accountId, personId };
}

async function loadConnectAccountId(
  supabase: SupabaseClient,
  subjectUserId: string,
  subjectType: IdentitySubjectType
): Promise<string | null> {
  if (subjectType === "driver") {
    const { data } = await supabase
      .from("driver_profiles")
      .select("stripe_account_id")
      .eq("user_id", subjectUserId)
      .maybeSingle();
    return data?.stripe_account_id ? String(data.stripe_account_id) : null;
  }

  if (subjectType === "restaurant") {
    const { data } = await supabase
      .from("restaurant_profiles")
      .select("stripe_account_id")
      .eq("user_id", subjectUserId)
      .maybeSingle();
    return data?.stripe_account_id ? String(data.stripe_account_id) : null;
  }

  if (subjectType === "seller") {
    const { data } = await supabase
      .from("sellers")
      .select("stripe_account_id")
      .eq("user_id", subjectUserId)
      .maybeSingle();
    return data?.stripe_account_id ? String(data.stripe_account_id) : null;
  }

  return null;
}

async function resolveRepresentativePersonId(
  accountId: string
): Promise<string | null> {
  try {
    const persons = await stripe.accounts.listPersons(accountId, { limit: 100 });
    const representative = persons.data.find(
      (person) => person.relationship?.representative === true
    );
    if (representative?.id) return representative.id;
    const owner = persons.data.find((person) => person.relationship?.owner === true);
    if (owner?.id) return owner.id;
    return persons.data[0]?.id ?? null;
  } catch (error) {
    console.warn("[connectBridge] listPersons failed", {
      accountId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}
