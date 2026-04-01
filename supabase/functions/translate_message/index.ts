import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Body = { message_id: string };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const GOOGLE_API_KEY = Deno.env.get("GOOGLE_TRANSLATE_API_KEY") ?? "";

function uniq(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

// "en-US" -> "en"
function normLocale(locale: string) {
  const x = (locale || "en").toLowerCase();
  return x.includes("-") ? x.split("-")[0] : x;
}

async function translateGoogle(text: string, sourceLang: string | null, targetLang: string) {
  if (!GOOGLE_API_KEY) throw new Error("Missing GOOGLE_TRANSLATE_API_KEY");

  const target = normLocale(targetLang);

  const body: Record<string, unknown> = {
    q: text,
    target,
    format: "text",
  };

  const src = sourceLang && sourceLang !== "und" ? normLocale(sourceLang) : null;
  if (src) body.source = src;

  const res = await fetch(
    `https://translation.googleapis.com/language/translate/v2?key=${GOOGLE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google translate error: ${res.status} ${err}`);
  }

  const json = await res.json();
  const translated = json?.data?.translations?.[0]?.translatedText;
  if (!translated) throw new Error("Google returned empty translation");

  return String(translated);
}

Deno.serve(async (req) => {
  try {
    // 1) Auth user (JWT)
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: auth } = await userClient.auth.getUser();
    const user = auth?.user;
    if (!user) return new Response("Unauthorized", { status: 401 });

    const body = (await req.json()) as Body;
    if (!body?.message_id) return new Response("Missing message_id", { status: 400 });

    // 2) Admin client for DB update
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 3) Load message
    const { data: msg, error: msgErr } = await admin
      .from("order_messages")
      .select("id, order_id, original_text, original_lang, translations, image_path, image_url")
      .eq("id", body.message_id)
      .single();

    if (msgErr || !msg) return new Response("Message not found", { status: 404 });

    // Ignore images
    if (msg.original_text === "[image]" || msg.image_path || msg.image_url) {
      return new Response(JSON.stringify({ ok: true, skipped: "image" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!msg.original_text) {
      return new Response("Message has no original_text", { status: 400 });
    }

    // 4) Check membership (must be in order_members)
    const { data: me, error: meErr } = await admin
      .from("order_members")
      .select("user_id")
      .eq("order_id", msg.order_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (meErr || !me) return new Response("Forbidden", { status: 403 });

    // 5) Get all members of this order
    const { data: members, error: memErr } = await admin
      .from("order_members")
      .select("user_id")
      .eq("order_id", msg.order_id);

    if (memErr || !members?.length) return new Response("No members", { status: 400 });

    const userIds = uniq(members.map((m) => m.user_id));

    // 6) Get their preferred locales
    const { data: profs, error: pErr } = await admin
      .from("profiles")
      .select("id, preferred_locale")
      .in("id", userIds);

    if (pErr) throw pErr;

    const localeById = new Map<string, string>();
    for (const p of profs ?? []) {
      localeById.set(p.id, normLocale(p.preferred_locale ?? "en"));
    }

    const targetLocales = uniq(userIds.map((id) => localeById.get(id) ?? "en"));

    // 7) Translate only needed locales
    const existing: Record<string, string> = (msg.translations ?? {}) as any;
    const src = msg.original_lang ?? "und";
    const srcNorm = normLocale(src);

    const targets = targetLocales
      .map(normLocale)
      .filter((l) => l && l !== srcNorm)
      .slice(0, 6);

    if (targets.length === 0) {
      return new Response(JSON.stringify({ ok: true, skipped: "no-target-locale" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const newTranslations: Record<string, string> = { ...existing };

    for (const lang of targets) {
      if (newTranslations[lang]) continue;
      newTranslations[lang] = await translateGoogle(msg.original_text, src, lang);
    }

    // 8) Update DB (and fix original_lang if it was und)
    const finalOriginalLang = src && src !== "und" ? srcNorm : srcNorm;

    const { error: upErr } = await admin
      .from("order_messages")
      .update({
        translations: newTranslations,
        original_lang: finalOriginalLang === "und" ? "und" : finalOriginalLang,
      })
      .eq("id", msg.id);

    if (upErr) throw upErr;

    return new Response(JSON.stringify({ ok: true, translated_to: targets }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(String((e as any)?.message ?? e), { status: 500 });
  }
});
