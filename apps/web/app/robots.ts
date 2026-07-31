import type { MetadataRoute } from "next";
import { CANONICAL_SITE_ORIGIN } from "@/lib/productionSite";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/admin/",
          "/account/",
          "/auth/",
          "/client/",
          "/orders/",
          "/seller/",
          "/stripe/",
          "/taxi/",
        ],
      },
    ],
    sitemap: `${CANONICAL_SITE_ORIGIN}/sitemap.xml`,
    host: CANONICAL_SITE_ORIGIN,
  };
}
