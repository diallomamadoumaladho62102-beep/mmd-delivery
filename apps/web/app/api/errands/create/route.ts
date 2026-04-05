// apps/web/src/app/api/errands/create/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ErrandCreateBody = {
  pickupAddress?: unknown;
  dropoffAddress?: unknown;
  pickupContact?: unknown;
  dropoffContact?: unknown;
  desc?: unknown;
  subtotal?: unknown;
  promoCode?: unknown;
};

function getEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing env: ${name}`);
  }
  return value;
}

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toNullableString(
  value: unknown,
  options?: { maxLength?: number; uppercase?: boolean }
): string | null {
  let text = toTrimmedString(value);
  if (!text) return null;

  if (options?.uppercase) {
    text = text.toUpperCase();
  }

  if (options?.maxLength && text.length > options.maxLength) {
    text = text.slice(0, options.maxLength);
  }

  return text;
}

function toMoneyNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(parsed * 100) / 100;
}

function assertNonNegativeMoney(name: string, value: number) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: Request) {
  try {
    const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const supabaseAnonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

    const cookieStore = await cookies();

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          for (const cookie of cookiesToSet) {
            cookieStore.set(cookie);
          }
        },
      },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return jsonError("Unauthorized", 401);
    }

    const body = (await req.json().catch(() => null)) as ErrandCreateBody | null;

    if (!body || typeof body !== "object") {
      return jsonError("Invalid JSON body", 400);
    }

    const pickupAddress = toTrimmedString(body.pickupAddress);
    const dropoffAddress = toTrimmedString(body.dropoffAddress);
    const pickupContact = toNullableString(body.pickupContact, { maxLength: 120 });
    const dropoffContact = toNullableString(body.dropoffContact, { maxLength: 120 });
    const description = toNullableString(body.desc, { maxLength: 2000 });
    const promoCode = toNullableString(body.promoCode, {
      maxLength: 32,
      uppercase: true,
    });
    const subtotal = toMoneyNumber(body.subtotal, 0);

    if (!pickupAddress) {
      return jsonError("pickupAddress is required", 400);
    }

    if (!dropoffAddress) {
      return jsonError("dropoffAddress is required", 400);
    }

    assertNonNegativeMoney("subtotal", subtotal);

    const { data, error } = await supabase.rpc("create_errand_order", {
      p_pickup_address: pickupAddress,
      p_dropoff_address: dropoffAddress,
      p_pickup_contact: pickupContact,
      p_dropoff_contact: dropoffContact,
      p_description: description,
      p_subtotal: subtotal,
      p_promo_code: promoCode,
    });

    if (error) {
      console.error("[api/errands/create] create_errand_order failed", {
        userId: user.id,
        message: error.message,
        code: (error as { code?: string }).code ?? null,
      });

      return jsonError(error.message, 400);
    }

    const order = Array.isArray(data) ? data[0] : data;
    const id = order?.id ?? null;

    if (!id) {
      console.error("[api/errands/create] RPC returned no id", {
        userId: user.id,
      });

      return jsonError("No id returned by create_errand_order", 500);
    }

    return NextResponse.json({ id });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";

    console.error("[api/errands/create] unexpected error", {
      message,
    });

    return jsonError(message, 500);
  }
}