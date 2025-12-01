import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function POST(req: Request) {
  // Next 16: cookies() est asynchrone
  const cookieStore = await cookies();

  // Client Supabase côté serveur avec gestion des cookies
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name) => cookieStore.get(name)?.value,
        set: (name, value, options) => cookieStore.set({ name, value, ...options }),
        remove: (name, options) => cookieStore.set({ name, value: "", ...options }),
      },
    }
  );

  const body = await req.json();

  const { data, error } = await supabase.rpc("create_errand_order", {
    p_pickup_address: body.pickupAddress,
    p_dropoff_address: body.dropoffAddress,
    p_pickup_contact: body.pickupContact,
    p_dropoff_contact: body.dropoffContact,
    p_description: body.desc,
    p_subtotal: body.subtotal ?? 0,
  });

  if (error) return new NextResponse(error.message, { status: 400 });

  // Normaliser la réponse ({ id })
  const order = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ id: order?.id });
}

