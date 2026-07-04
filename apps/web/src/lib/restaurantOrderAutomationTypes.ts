export type RestaurantPaperWidth = "58mm" | "80mm";

export type RestaurantPrintJobType = "kitchen" | "customer" | "driver" | "test";

export type RestaurantPrintJobStatus =
  | "pending"
  | "printing"
  | "printed"
  | "failed"
  | "canceled";

export type RestaurantOrderAutomationSettings = {
  auto_accept_orders_enabled: boolean;
  auto_accept_only_during_hours: boolean;
  default_prep_minutes: number;
  auto_pause_when_closed: boolean;
  auto_pause_when_busy: boolean;
  busy_order_threshold: number;
  auto_print_enabled: boolean;
  print_kitchen_ticket: boolean;
  print_customer_ticket: boolean;
  print_driver_ticket: boolean;
  print_copies: number;
  print_paper_width: RestaurantPaperWidth;
  print_show_qr_code: boolean;
  print_special_instructions: boolean;
};

export type RestaurantAutomationProfile = RestaurantOrderAutomationSettings & {
  user_id: string;
  restaurant_name: string | null;
  status: string | null;
  is_accepting_orders: boolean | null;
  opening_hours: Record<string, { open?: string; close?: string }> | null;
};

export const DEFAULT_RESTAURANT_AUTOMATION_SETTINGS: RestaurantOrderAutomationSettings =
  {
    auto_accept_orders_enabled: false,
    auto_accept_only_during_hours: true,
    default_prep_minutes: 20,
    auto_pause_when_closed: true,
    auto_pause_when_busy: false,
    busy_order_threshold: 12,
    auto_print_enabled: false,
    print_kitchen_ticket: true,
    print_customer_ticket: true,
    print_driver_ticket: true,
    print_copies: 1,
    print_paper_width: "80mm",
    print_show_qr_code: true,
    print_special_instructions: true,
  };
