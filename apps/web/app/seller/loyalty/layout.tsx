import { requireSellerWebSession } from "@/lib/requireSellerWebSession";

export default async function SellerLoyaltyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSellerWebSession();
  return <>{children}</>;
}
