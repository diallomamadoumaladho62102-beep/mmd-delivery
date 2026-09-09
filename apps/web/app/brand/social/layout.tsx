import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MMD Delivery · Social & QR Kit",
  description:
    "Official MMD Delivery social links and printable QR codes for marketing materials.",
};

export default function SocialBrandKitLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
