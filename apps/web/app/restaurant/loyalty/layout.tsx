import { requireRestaurantWebSession } from "@/lib/requireRestaurantWebSession";

export default async function RestaurantLoyaltyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRestaurantWebSession();
  return <>{children}</>;
}
