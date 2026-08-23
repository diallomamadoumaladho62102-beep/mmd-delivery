/**
 * Shared food/package Connect credit invoke (platform → Connect SCT).
 * Wraps POST /api/stripe/transfers/run so process-payouts and ensureWorkerConnectCredit
 * share one client path. Amounts / Connect account / idempotency stay inside transfers/run.
 */
export type OrderConnectTransferInvokeResult = {
  ok: boolean;
  status: number;
  transferId: string | null;
  already?: boolean;
  error?: string;
  raw?: unknown;
};

export async function invokeOrderConnectTransfer(params: {
  baseUrl: string;
  authorizationHeader: string;
  orderId: string;
  target: "driver" | "restaurant";
  dryRun?: boolean;
}): Promise<OrderConnectTransferInvokeResult> {
  const base = String(params.baseUrl ?? "")
    .trim()
    .replace(/\/$/, "");
  const orderId = String(params.orderId ?? "").trim();
  const target = params.target;
  if (!base || !orderId) {
    return {
      ok: false,
      status: 400,
      transferId: null,
      error: "baseUrl_and_orderId_required",
    };
  }

  const response = await fetch(`${base}/api/stripe/transfers/run`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Authorization: params.authorizationHeader,
    },
    body: JSON.stringify({
      order_id: orderId,
      target,
      dry_run: params.dryRun === true,
    }),
  });

  const raw = await response.json().catch(() => null);
  const transferId =
    raw && typeof raw === "object"
      ? String(
          (raw as { transfer_id?: unknown; stripe_transfer_id?: unknown })
            .transfer_id ??
            (raw as { stripe_transfer_id?: unknown }).stripe_transfer_id ??
            "",
        ).trim() || null
      : null;
  const already =
    raw && typeof raw === "object"
      ? Boolean(
          (raw as { already?: unknown; already_transferred?: unknown }).already ??
            (raw as { already_transferred?: unknown }).already_transferred,
        )
      : false;

  if (!response.ok) {
    const error =
      raw && typeof raw === "object"
        ? String(
            (raw as { error?: unknown; message?: unknown }).error ??
              (raw as { message?: unknown }).message ??
              `http_${response.status}`,
          )
        : `http_${response.status}`;
    return {
      ok: false,
      status: response.status,
      transferId,
      error,
      raw,
    };
  }

  return {
    ok: true,
    status: response.status,
    transferId,
    already,
    raw,
  };
}
