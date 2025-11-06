export type Order = {
  id: string;
  items_subtotal: number | null;
  tax_amount: number | null;
  delivery_fee: number | null;
  discounts: number | null;
  grand_total: number | null;
  commission_client: number | null;
  commission_driver: number | null;
  commission_restaurant: number | null;
  commission_total: number | null;
  // ... autres champs existants
};

