import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MMD Delivery",
  description: "Application MMD Delivery",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body className="bg-gray-50 min-h-screen">
        {children}
      </body>
    </html>
  );
}