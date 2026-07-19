import { requireRestaurantWebSession } from "@/lib/requireRestaurantWebSession";

export default async function RestaurantSubscriptionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRestaurantWebSession();
  return <>{children}</>;
}
