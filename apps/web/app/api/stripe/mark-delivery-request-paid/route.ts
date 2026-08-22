/**
 * Legacy alias — canonical handler is confirm-delivery-request-paid (idempotent, ownership-checked).
 * Mobile and web clients should call confirm-delivery-request-paid; this route remains for old bookmarks.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export { POST } from "../client/confirm-delivery-request-paid/route";
