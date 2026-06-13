/**
 * Admin AI domain — planned, not implemented in Phase 1.
 *
 * Future scope:
 * - Staff RBAC-gated /api/ai/admin/chat
 * - Order lookup across tenants with audit
 * - Communication moderation assist
 * - Ops runbooks (read-only)
 *
 * Do not wire routes until explicit validation.
 */
export const ADMIN_AI_DOMAIN_STATUS = "planned" as const;

export type AdminAiDomainPlan = {
  status: typeof ADMIN_AI_DOMAIN_STATUS;
  route: "/api/ai/admin/chat";
  requiredRoles: Array<"admin" | "ops" | "support" | "finance" | "review">;
};

export const adminAiDomainPlan: AdminAiDomainPlan = {
  status: ADMIN_AI_DOMAIN_STATUS,
  route: "/api/ai/admin/chat",
  requiredRoles: ["admin", "ops", "support", "finance", "review"],
};
