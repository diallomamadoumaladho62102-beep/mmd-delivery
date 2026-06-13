import type { AiAction } from "@/lib/ai/aiTypes";

export function getSupportContactInfo(): {
  email: string;
  supportUrl: string;
  actions: AiAction[];
} {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://www.mmddelivery.com";
  const supportUrl =
    process.env.NEXT_PUBLIC_SUPPORT_URL?.trim() || `${siteUrl}/legal/support`;

  return {
    email: "support@mmddelivery.com",
    supportUrl,
    actions: [
      {
        type: "navigate",
        label: "Contact support",
        route: "ClientInbox",
        params: {},
        icon: "support",
      },
    ],
  };
}
