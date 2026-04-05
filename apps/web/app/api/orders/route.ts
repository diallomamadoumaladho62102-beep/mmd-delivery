import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY! // ⚠️ Service Role: serveur uniquement
    );

    const { data, error } = await supabase
      .from("orders")
      .insert({
        kind: body.kind,
        pickup_kind: body.pickup_kind,
        pickup_address: body.pickup_address || "TBD",
        dropoff_address: body.dropoff_address || "TBD",
        subtotal_cents: 0,
        delivery_fee_cents: 0,
        taxes_cents: 0
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}

