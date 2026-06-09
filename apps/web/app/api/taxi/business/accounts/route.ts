import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BusinessAccountJoin = {
  id: string;
  name: string;
  slug: string;
  active?: boolean;
  taxi_business_ride_policies?: Record<string, unknown>[] | null;
};

function normalizeBusinessAccountJoin(
  value: BusinessAccountJoin | BusinessAccountJoin[] | null | undefined
): BusinessAccountJoin | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const { data: memberships, error } = await auth.supabaseUser
      .from("taxi_business_members")
      .select(
        `
        id,
        role,
        business_account_id,
        taxi_business_accounts:business_account_id (
          id,
          name,
          slug,
          active,
          taxi_business_ride_policies (
            max_ride_cents,
            max_daily_cents,
            max_weekly_cents,
            requires_manager_approval,
            active
          )
        )
      `
      )
      .eq("user_id", auth.user.id)
      .eq("active", true);

    if (error) {
      return taxiJson({ ok: false, error: error.message }, 500);
    }

    const accounts = (memberships ?? [])
      .map((row) => {
        const account = normalizeBusinessAccountJoin(
          row.taxi_business_accounts as
            | BusinessAccountJoin
            | BusinessAccountJoin[]
            | null
            | undefined
        );
        if (account?.active === false) return null;
        return {
          member_id: row.id,
          role: row.role,
          account: account
            ? { id: account.id, name: account.name, slug: account.slug }
            : null,
          policy: account?.taxi_business_ride_policies?.[0] ?? null,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row != null);

    return taxiJson({ ok: true, accounts });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}

export async function POST() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
