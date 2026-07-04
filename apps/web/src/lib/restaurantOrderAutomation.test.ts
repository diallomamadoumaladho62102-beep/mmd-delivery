import assert from "node:assert/strict";
import test from "node:test";
import { isRestaurantWithinOpeningHours } from "./restaurantOpeningHours";
import {
  evaluateAutoAcceptEligibility,
  extractAutomationSettings,
} from "./restaurantOrderAutomation";

test("isRestaurantWithinOpeningHours accepts current slot", () => {
  const now = new Date("2026-07-07T15:00:00");
  const open = isRestaurantWithinOpeningHours(
    {
      tuesday: { open: "09:00", close: "22:00" },
    },
    now,
  );
  assert.equal(open, true);
});

test("isRestaurantWithinOpeningHours rejects outside slot", () => {
  const now = new Date("2026-07-07T23:30:00");
  const open = isRestaurantWithinOpeningHours(
    {
      tuesday: { open: "09:00", close: "22:00" },
    },
    now,
  );
  assert.equal(open, false);
});

test("evaluateAutoAcceptEligibility blocks unpaid orders", async () => {
  const result = await evaluateAutoAcceptEligibility(
    {
      from: () => ({
        select: () => ({
          in: async () => ({ data: [], error: null }),
        }),
      }),
    } as any,
    {
      profile: {
        user_id: "r1",
        restaurant_name: "Test",
        status: "approved",
        is_accepting_orders: true,
        opening_hours: { monday: { open: "00:00", close: "23:59" } },
        auto_accept_orders_enabled: true,
        auto_accept_only_during_hours: false,
        default_prep_minutes: 20,
        auto_pause_when_closed: false,
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
      },
      order: {
        kind: "food",
        status: "pending",
        payment_status: "unpaid",
        items_json: [],
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, "payment_not_confirmed");
});

test("extractAutomationSettings applies defaults", () => {
  const settings = extractAutomationSettings(null);
  assert.equal(settings.auto_accept_orders_enabled, false);
  assert.equal(settings.default_prep_minutes, 20);
});
