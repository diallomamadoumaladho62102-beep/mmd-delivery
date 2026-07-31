import { NextRequest } from "next/server";
import { assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { DEFAULT_SITE_LOCALE } from "@/lib/siteCms";
import {
  adminError,
  cleanBool,
  cleanInt,
  cleanText,
  json,
  revalidateSiteCms,
} from "../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MenuKey = "header" | "footer";

function asMenuKey(value: unknown): MenuKey | null {
  const t = cleanText(value, 20);
  if (t === "header" || t === "footer") return t;
  return null;
}

async function ensureMenu(
  supabase: ReturnType<typeof buildSupabaseAdminClient>,
  key: MenuKey,
) {
  const { data: existing } = await supabase
    .from("site_menus")
    .select("id,locale,key,label")
    .eq("locale", DEFAULT_SITE_LOCALE)
    .eq("key", key)
    .maybeSingle();
  if (existing) return existing;

  const { data, error } = await supabase
    .from("site_menus")
    .insert({
      locale: DEFAULT_SITE_LOCALE,
      key,
      label: key === "header" ? "Header" : "Footer",
    })
    .select("id,locale,key,label")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data!;
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("marketing.read", request);
    const supabase = buildSupabaseAdminClient();
    const keyParam = asMenuKey(request.nextUrl.searchParams.get("key"));

    const keys: MenuKey[] = keyParam ? [keyParam] : ["header", "footer"];
    const menus: Record<string, unknown> = {};

    for (const key of keys) {
      const menu = await ensureMenu(supabase, key);
      const { data: items, error } = await supabase
        .from("site_menu_items")
        .select("*")
        .eq("menu_id", menu.id)
        .order("sort_order", { ascending: true });
      if (error) return json({ ok: false, error: error.message }, 500);
      menus[key] = { menu, items: items ?? [] };
    }

    return json({ ok: true, menus });
  } catch (e) {
    return adminError(e);
  }
}

export async function PUT(request: NextRequest) {
  try {
    await assertStaffPermission("marketing.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const key = asMenuKey(body.key);
    if (!key) return json({ ok: false, error: "key must be header|footer" }, 400);
    if (!Array.isArray(body.items)) {
      return json({ ok: false, error: "items array required" }, 400);
    }

    const menu = await ensureMenu(supabase, key);

    const { error: delErr } = await supabase
      .from("site_menu_items")
      .delete()
      .eq("menu_id", menu.id);
    if (delErr) return json({ ok: false, error: delErr.message }, 500);

    const rows = body.items
      .map((raw, index) => {
        const item = (raw ?? {}) as Record<string, unknown>;
        const label = cleanText(item.label, 120);
        const href = cleanText(item.href, 500);
        if (!label || !href) return null;
        return {
          menu_id: menu.id,
          label,
          href,
          target: cleanText(item.target, 20) ?? "_self",
          sort_order:
            item.sort_order !== undefined
              ? cleanInt(item.sort_order, (index + 1) * 10)
              : (index + 1) * 10,
          visible: cleanBool(item.visible, true),
          parent_id: cleanText(item.parent_id, 80),
        };
      })
      .filter((r): r is NonNullable<typeof r> => Boolean(r));

    if (rows.length > 0) {
      const { error: insErr } = await supabase
        .from("site_menu_items")
        .insert(rows);
      if (insErr) return json({ ok: false, error: insErr.message }, 500);
    }

    const { data: items } = await supabase
      .from("site_menu_items")
      .select("*")
      .eq("menu_id", menu.id)
      .order("sort_order", { ascending: true });

    revalidateSiteCms();
    return json({ ok: true, menu, items: items ?? [] });
  } catch (e) {
    return adminError(e);
  }
}
