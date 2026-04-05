"use client";

import { useEffect, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";

type ClientProfileRow = {
  user_id: string;
  phone: string | null;
  default_address: string | null;
  floor: string | null;
  door_code: string | null;
  delivery_notes: string | null;
  marketing_opt_in: boolean;
};

type AccountInfo = {
  full_name: string | null;
  email: string | null;
};

export default function ClientProfilePage() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [profile, setProfile] = useState<ClientProfileRow | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);
      setOk(null);

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) {
        console.error(userError);
        if (!cancelled) {
          setErr(userError.message);
          setLoading(false);
        }
        return;
      }

      const user = userData.user;
      if (!user) {
        if (!cancelled) {
          setErr("Tu dois te connecter pour accéder à ton profil client.");
          router.push("/auth/login");
          setLoading(false);
        }
        return;
      }

      const uid = user.id;
      if (cancelled) return;
      setUserId(uid);

      // Compte (nom + email)
      let initialAccount: AccountInfo = {
        full_name: null,
        email: user.email ?? null,
      };

      const { data: profRow, error: profError } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", uid)
        .maybeSingle();

      if (profError) {
        console.error(profError);
      } else if (profRow) {
        initialAccount.full_name = profRow.full_name ?? null;
      }

      if (!cancelled) {
        setAccount(initialAccount);
      }

      // Profil client
      const { data: cpRow, error: cpError } = await supabase
        .from("client_profiles")
        .select("*")
        .eq("user_id", uid)
        .maybeSingle();

      if (cpError && cpError.code !== "PGRST116") {
        console.error(cpError);
        if (!cancelled) {
          setErr(cpError.message);
        }
      }

      const cp: ClientProfileRow = {
        user_id: uid,
        phone: (cpRow?.phone as string | null) ?? "",
        default_address: (cpRow?.default_address as string | null) ?? "",
        floor: (cpRow?.floor as string | null) ?? "",
        door_code: (cpRow?.door_code as string | null) ?? "",
        delivery_notes: (cpRow?.delivery_notes as string | null) ?? "",
        marketing_opt_in:
          typeof cpRow?.marketing_opt_in === "boolean"
            ? cpRow.marketing_opt_in
            : false,
      };

      if (!cancelled) {
        setProfile(cp);
        setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [router]);

  function onChangeAccountName(value: string) {
    setAccount((prev) =>
      prev ? { ...prev, full_name: value } : { full_name: value, email: null }
    );
  }

  function onChangeField(
    field:
      | "phone"
      | "default_address"
      | "floor"
      | "door_code"
      | "delivery_notes"
      | "marketing_opt_in",
    value: string | boolean
  ) {
    if (!profile) return;
    const updated: ClientProfileRow = { ...profile };

    if (field === "marketing_opt_in") {
      updated.marketing_opt_in = Boolean(value);
    } else {
      (updated as any)[field] = (value as string) || "";
    }

    setProfile(updated);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!userId || !profile) return;

    setSaving(true);
    setErr(null);
    setOk(null);

    // Mettre à jour le nom dans profiles
    if (account) {
      const { error: accError } = await supabase
        .from("profiles")
        .update({ full_name: account.full_name })
        .eq("id", userId);

      if (accError) {
        console.error(accError);
        setErr(accError.message);
        setSaving(false);
        return;
      }
    }

    const payload = {
      user_id: userId,
      phone: profile.phone || null,
      default_address: profile.default_address || null,
      floor: profile.floor || null,
      door_code: profile.door_code || null,
      delivery_notes: profile.delivery_notes || null,
      marketing_opt_in: profile.marketing_opt_in,
    };

    const { error } = await supabase
      .from("client_profiles")
      .upsert(payload, { onConflict: "user_id" });

    if (error) {
      console.error(error);
      setErr(error.message);
    } else {
      setOk("Profil client enregistré avec succès ✅");
    }

    setSaving(false);
  }

  if (loading || !profile) {
    return (
      <main className="max-w-xl mx-auto p-4">
        <h1 className="text-xl font-semibold mb-2">Mon profil client</h1>
        <p>Chargement…</p>
      </main>
    );
  }

  if (!userId) {
    return (
      <main className="max-w-xl mx-auto p-4">
        <h1 className="text-xl font-semibold mb-2">Mon profil client</h1>
        <p>Tu dois être connecté pour voir cette page.</p>
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-bold">Mon profil client</h1>

      {err && <p className="text-sm text-red-600">{err}</p>}
      {ok && <p className="text-sm text-green-600">{ok}</p>}

      <form
        onSubmit={onSubmit}
        className="space-y-4 border rounded-lg p-4 bg-white"
      >
        {/* COMPTE */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Informations du compte</h2>

          <label className="block text-sm font-medium">
            Nom complet
            <input
              type="text"
              className="mt-1 w-full border rounded px-3 py-2 text-sm"
              value={account?.full_name ?? ""}
              onChange={(e) => onChangeAccountName(e.target.value)}
              placeholder="Mamadou Maladho Diallo"
            />
          </label>

          <label className="block text-sm font-medium">
            Adresse email (compte)
            <input
              type="text"
              className="mt-1 w-full border rounded px-3 py-2 text-sm bg-gray-100"
              value={account?.email ?? ""}
              readOnly
            />
          </label>
        </div>

        {/* CONTACT & ADRESSE */}
        <div className="space-y-3 border-t pt-4">
          <h2 className="text-lg font-semibold">Adresse & contact</h2>

          <label className="block text-sm font-medium">
            Téléphone
            <input
              type="tel"
              className="mt-1 w-full border rounded px-3 py-2 text-sm"
              value={profile.phone ?? ""}
              onChange={(e) => onChangeField("phone", e.target.value)}
              placeholder="9297408722"
            />
          </label>

          <label className="block text-sm font-medium">
            Adresse principale
            <input
              type="text"
              className="mt-1 w-full border rounded px-3 py-2 text-sm"
              value={profile.default_address ?? ""}
              onChange={(e) =>
                onChangeField("default_address", e.target.value)
              }
              placeholder="1112 Flatbush Av, Brooklyn NY"
            />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-sm font-medium">
              Étage / Appartement
              <input
                type="text"
                className="mt-1 w-full border rounded px-3 py-2 text-sm"
                value={profile.floor ?? ""}
                onChange={(e) => onChangeField("floor", e.target.value)}
                placeholder="Apt 3B, 2nd Floor…"
              />
            </label>

            <label className="block text-sm font-medium">
              Code porte / Interphone
              <input
                type="text"
                className="mt-1 w-full border rounded px-3 py-2 text-sm"
                value={profile.door_code ?? ""}
                onChange={(e) => onChangeField("door_code", e.target.value)}
                placeholder="Code 1234#"
              />
            </label>
          </div>

          <label className="block text-sm font-medium">
            Instructions pour la livraison
            <textarea
              className="mt-1 w-full border rounded px-3 py-2 text-sm min-h-[70px]"
              value={profile.delivery_notes ?? ""}
              onChange={(e) =>
                onChangeField("delivery_notes", e.target.value)
              }
              placeholder="Ex: Laissez devant la porte, appelez quand vous arrivez…"
            />
          </label>
        </div>

        {/* PREFERENCES */}
        <div className="space-y-3 border-t pt-4">
          <h2 className="text-lg font-semibold">Préférences</h2>

          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={profile.marketing_opt_in}
              onChange={(e) =>
                onChangeField("marketing_opt_in", e.target.checked)
              }
            />
            <span>
              Je souhaite recevoir des offres et promotions MMD Delivery.
            </span>
          </label>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-medium border bg-black text-white disabled:opacity-60"
          >
            {saving ? "Enregistrement…" : "Enregistrer mon profil client"}
          </button>
        </div>
      </form>
    </main>
  );
}
