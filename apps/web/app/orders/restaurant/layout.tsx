import { requireRestaurantWebSession } from "@/lib/requireRestaurantWebSession";

export default async function OrdersRestaurantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRestaurantWebSession();
  return <>{children}</>;
}
