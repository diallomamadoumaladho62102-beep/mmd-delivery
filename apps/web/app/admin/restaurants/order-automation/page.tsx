"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { canReviewRestaurants } from "@/lib/adminAccess";
import { adminFetch } from "@/lib/adminBrowserAuth";
import { supabase } from "@/lib/supabaseBrowser";

type Settings = Record<string, boolean | number | string>;

export default function AdminRestaurantAutomationPage() {
  const [role, setRole] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [restaurantName, setRestaurantName] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const authUserId = data.user?.id;
      if (!authUserId) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", authUserId)
        .maybeSingle();
      setRole(profile?.role ?? null);
    })();
  }, []);

  const canManage = canReviewRestaurants(role as any);

  const load = useCallback(async () => {
    if (!userId.trim()) return;
    setMessage(null);
    const res = await adminFetch(
      `/api/admin/restaurants/order-automation?userId=${encodeURIComponent(userId.trim())}`,
    );
    const body = await res.json();
    if (!res.ok || body.ok === false) {
      setMessage(String(body.error ?? "load_failed"));
      setSettings(null);
      return;
    }
    setSettings(body.settings ?? null);
    setRestaurantName(body.restaurant_name ?? null);
  }, [userId]);

  const save = useCallback(async () => {
    if (!settings || !userId.trim()) return;
    setMessage(null);
    const res = await adminFetch("/api/admin/restaurants/order-automation", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: userId.trim(), ...settings }),
    });
    const body = await res.json();
    if (!res.ok || body.ok === false) {
      setMessage(String(body.error ?? "save_failed"));
      return;
    }
    setSettings(body.settings);
    setMessage("Paramètres enregistrés.");
  }, [settings, userId]);

  if (!canManage) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Automation restaurant</h1>
        <p>Accès refusé.</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 24, maxWidth: 760, display: "grid", gap: 16 }}>
      <Link href="/admin/restaurants">← Retour restaurants</Link>
      <h1>Automation commandes & impression</h1>
      <label style={{ display: "grid", gap: 6 }}>
        Restaurant user ID
        <input value={userId} onChange={(e) => setUserId(e.target.value)} />
      </label>
      <button type="button" onClick={() => void load()}>
        Charger
      </button>
      {restaurantName ? <p>Restaurant: {restaurantName}</p> : null}
      {settings ? (
        <>
          {[
            "auto_accept_orders_enabled",
            "auto_print_enabled",
            "auto_accept_only_during_hours",
            "auto_pause_when_closed",
            "auto_pause_when_busy",
            "print_kitchen_ticket",
            "print_customer_ticket",
            "print_driver_ticket",
          ].map((key) => (
            <label key={key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={Boolean(settings[key])}
                onChange={(e) =>
                  setSettings((prev) => ({ ...(prev ?? {}), [key]: e.target.checked }))
                }
              />
              {key}
            </label>
          ))}
          <label style={{ display: "grid", gap: 6 }}>
            default_prep_minutes
            <input
              type="number"
              value={Number(settings.default_prep_minutes ?? 20)}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...(prev ?? {}),
                  default_prep_minutes: Number(e.target.value),
                }))
              }
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            print_copies
            <input
              type="number"
              value={Number(settings.print_copies ?? 1)}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...(prev ?? {}),
                  print_copies: Number(e.target.value),
                }))
              }
            />
          </label>
          <button type="button" onClick={() => void save()}>
            Enregistrer
          </button>
        </>
      ) : null}
      {message ? <p>{message}</p> : null}
    </main>
  );
}
