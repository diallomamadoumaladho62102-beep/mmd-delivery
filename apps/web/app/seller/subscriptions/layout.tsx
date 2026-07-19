import { requireSellerWebSession } from "@/lib/requireSellerWebSession";

export default async function SellerSubscriptionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSellerWebSession();
  return <>{children}</>;
}
