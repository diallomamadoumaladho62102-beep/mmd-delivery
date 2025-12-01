import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) {
    return NextResponse.json({ error: "Missing Supabase env vars" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const email = searchParams.get("email");
  const redirect = searchParams.get("redirect") || "http://localhost:3000";

  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const admin = createClient(url, key);

  // Génère un lien magique sans envoyer d’email
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { emailRedirectTo: redirect },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // v2: le lien est dans data.properties.action_link
  const actionLink =
    // @ts-ignore (compat variantes)
    data?.properties?.action_link || data?.action_link;

  if (!actionLink) {
    return NextResponse.json({ error: "No action_link returned" }, { status: 500 });
  }

  return NextResponse.redirect(actionLink);
}

