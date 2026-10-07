"use client";

import { useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { adminFetch } from "@/lib/adminBrowserAuth";
import { useAdminT } from "@/i18n/useAdminT";

type Row = {
  id: string;
  entity_id: string;
  service_type: string;
  actor_role: string;
  actor_user_id: string;
  actor_name: string | null;
  actor_email: string | null;
  actor_phone: string | null;
  reason_code: string;
  reason_label: string;
  reason_note: string | null;
  created_at: string;
  previous_status: string | null;
  resulting_status: string | null;
  wait_fee_cents: number | null;
  refund_amount_cents: number | null;
  payment_status: string | null;
  acceptance_rate_impact: boolean;
  cancellation_rate_impact: boolean;
  no_show: boolean;
  post_acceptance: boolean;
  cancellation_source: string;
  wait_minutes: number | null;
  metadata: Record<string, unknown> | null;
};

function CancellationReviewBody() {
  const { t, locale } = useAdminT();
  const [rows, setRows] = useState<Row[]>([]);
  const [service, setService] = useState("");
  const [actor, setActor] = useState("");
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [noShow, setNoShow] = useState(false);
  const [postAcceptance, setPostAcceptance] = useState(false);
  const [waitingFee, setWaitingFee] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("entity_id");
    if (initial) setQuery(initial);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ locale });
    if (service) params.set("service", service);
    if (actor) params.set("actor", actor);
    if (/^[0-9a-f-]{36}$/i.test(query.trim())) params.set("entity_id", query.trim());
    if (reason.trim()) params.set("reason", reason.trim());
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (noShow) params.set("no_show", "1");
    if (postAcceptance) params.set("post_acceptance", "1");
    if (waitingFee) params.set("waiting_fee", "1");
    void adminFetch(`/api/admin/cancellations?${params.toString()}`)
      .then(async (res) => {
        const body = (await res.json()) as { ok?: boolean; cancellations?: Row[]; error?: string };
        if (!res.ok || body.ok === false) {
          setError(body.error ?? t("Unable to load cancellations"));
          return;
        }
        setRows(body.cancellations ?? []);
        setError(null);
      })
      .catch(() => setError(t("Unable to load cancellations")));
  }, [actor, from, locale, noShow, postAcceptance, query, reason, service, t, to, waitingFee]);

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4">
      <h1 className="text-2xl font-semibold text-slate-900">{t("Cancellation review")}</h1>
      <div className="flex flex-wrap gap-2">
        <select className="rounded border px-2 py-1" value={service} onChange={(e) => setService(e.target.value)}>
          <option value="">{t("All services")}</option>
          <option value="taxi">Taxi</option>
          <option value="food">Food</option>
          <option value="package">Package</option>
          <option value="marketplace">Marketplace</option>
        </select>
        <select className="rounded border px-2 py-1" value={actor} onChange={(e) => setActor(e.target.value)}>
          <option value="">{t("All actors")}</option>
          <option value="client">{t("Customer")}</option>
          <option value="driver">{t("Driver")}</option>
          <option value="restaurant">{t("Restaurant")}</option>
          <option value="seller">{t("Seller")}</option>
        </select>
        <input
          className="rounded border px-2 py-1"
          placeholder={t("Ride or order ID")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <input
          className="rounded border px-2 py-1"
          placeholder={t("Reason code")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <input className="rounded border px-2 py-1" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input className="rounded border px-2 py-1" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={noShow} onChange={(e) => setNoShow(e.target.checked)} />
          {t("No-show")}
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={postAcceptance} onChange={(e) => setPostAcceptance(e.target.checked)} />
          {t("Post-acceptance")}
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={waitingFee} onChange={(e) => setWaitingFee(e.target.checked)} />
          {t("Waiting fee")}
        </label>
      </div>
      {error ? <p className="text-red-700">{error}</p> : null}
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id} className="rounded-xl border bg-white p-4 text-sm text-slate-800">
            <div className="font-semibold">{row.reason_label}</div>
            <div>{row.reason_code}{row.reason_note ? ` — ${row.reason_note}` : ""}</div>
            <div>
              {row.service_type} · {row.entity_id} · {row.previous_status ?? "—"} → {row.resulting_status ?? "—"}
            </div>
            <div>
              {row.actor_role}: {row.actor_name ?? row.actor_user_id}
              {row.actor_email ? ` · ${row.actor_email}` : ""}
              {row.actor_phone ? ` · ${row.actor_phone}` : ""}
            </div>
            <div>
              {t("Acceptance rate impact")}: {row.acceptance_rate_impact ? t("yes") : t("no")}
              {" · "}
              {t("Cancellation metric")}: {row.cancellation_rate_impact ? t("yes") : t("no")}
              {" · "}
              {t("No-show")}: {row.no_show ? t("yes") : t("no")}
              {" · "}
              {t("Post-acceptance")}: {row.post_acceptance ? t("yes") : t("no")}
            </div>
            <div>
              {t("Payment")}: {row.payment_status ?? "—"} · {t("Refund cents")}: {row.refund_amount_cents ?? "—"} · {t("Wait fee cents")}: {row.wait_fee_cents ?? "—"}
              {" · "}
              {t("Wait minutes")}: {row.wait_minutes ?? "—"}
              {row.metadata?.free_wait_minutes != null ? ` · ${t("Free wait minutes")}: ${String(row.metadata.free_wait_minutes)}` : ""}
              {row.metadata?.billable_wait_minutes != null ? ` · ${t("Billable wait minutes")}: ${String(row.metadata.billable_wait_minutes)}` : ""}
              {row.metadata?.wait_fee_collected != null ? ` · ${t("Wait fee collected")}: ${row.metadata.wait_fee_collected ? t("yes") : t("no")}` : ""}
              {row.metadata?.quoted_total_cents != null ? ` · ${t("Quoted cents")}: ${String(row.metadata.quoted_total_cents)}` : ""}
              {row.metadata?.cancel_fee_cents != null ? ` · ${t("Cancellation fee cents")}: ${String(row.metadata.cancel_fee_cents)}` : ""}
              {row.metadata?.stripe_payment_intent_id ? ` · ${t("Payment reference")}: ${String(row.metadata.stripe_payment_intent_id)}` : ""}
            </div>
            <div>{row.created_at} · {row.cancellation_source}</div>
          </li>
        ))}
      </ul>
    </main>
  );
}

export default function AdminCancellationsPage() {
  return (
    <AdminGate requiredPermission="orders.read">
      <CancellationReviewBody />
    </AdminGate>
  );
}
