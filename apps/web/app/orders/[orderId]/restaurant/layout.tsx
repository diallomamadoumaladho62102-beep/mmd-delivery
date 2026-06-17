import { requireRestaurantWebSession } from "@/lib/requireRestaurantWebSession";

export default async function RestaurantOrderDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  await requireRestaurantWebSession({ orderId });
  return <>{children}</>;
}
