import assert from "node:assert/strict";
import {
  DEFAULT_FOOD_ORDER_FILTERS,
  buildAdminFoodOrderParty,
  countOrderItems,
  filterFoodOrders,
  filtersToSearchParams,
  formatOrderMoney,
  normalizeSearchText,
  orderAmountNumber,
  orderStatusBadge,
  parseFiltersFromSearchParams,
  partyDisplayName,
  paymentStatusBadge,
  sanitizeDisplayPhone,
  shortOrderId,
  sortFoodOrders,
  statusStepperIndex,
  type AdminFoodOrderListItem,
} from "./adminFoodOrderDisplay";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function sample(partial: Partial<AdminFoodOrderListItem> = {}): AdminFoodOrderListItem {
  return {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    status: "ready",
    kind: "food",
    payment_status: "paid",
    subtotal: 20,
    total: 25,
    total_cents: 2500,
    currency: "USD",
    restaurant_name: "Chez Moussa",
    restaurant_id: "rest-1",
    restaurant_user_id: "rest-1",
    client_id: "client-1",
    client_user_id: "client-1",
    user_id: "client-1",
    driver_id: "driver-1",
    created_at: "2026-07-01T12:00:00.000Z",
    paid_at: "2026-07-01T12:05:00.000Z",
    delivered_confirmed_at: null,
    items_json: [{ name: "Thiéb", quantity: 2 }],
    distance_miles: 3.2,
    eta_minutes: 25,
    delivery_fee: 3,
    pickup_address: "100 Main St",
    dropoff_address: "200 Oak Ave",
    promo_code_applied: null,
    item_count: 2,
    client: {
      id: "client-1",
      full_name: "Awa Diallo",
      email: "awa@example.com",
      phone: "+15551212",
      avatar_url: null,
      account_kind: "real",
    },
    driver: {
      id: "driver-1",
      full_name: "Ibrahima Ba",
      email: "ib@example.com",
      phone: null,
      avatar_url: null,
      account_kind: "real",
    },
    restaurant: {
      id: "rest-1",
      name: "Chez Moussa",
      logo_url: null,
    },
    ...partial,
  };
}

test("normalizeSearchText strips accents", () => {
  assert.equal(normalizeSearchText("Thiéboudienne"), "thieboudienne");
});

test("countOrderItems sums quantities", () => {
  assert.equal(countOrderItems([{ quantity: 2 }, { quantity: 1 }]), 3);
  assert.equal(countOrderItems(null), 0);
});

test("orderAmountNumber prefers total_cents", () => {
  assert.equal(orderAmountNumber(sample()), 25);
  assert.equal(orderAmountNumber(sample({ total_cents: null, total: 18 })), 18);
});

test("formatOrderMoney formats USD", () => {
  assert.match(formatOrderMoney(sample()), /\$25\.00/);
});

test("shortOrderId truncates", () => {
  assert.equal(shortOrderId(sample().id), "aaaaaaaa");
});

test("status and payment badges", () => {
  assert.equal(orderStatusBadge("delivered").tone, "green");
  assert.equal(orderStatusBadge("canceled").tone, "red");
  assert.equal(paymentStatusBadge("paid").tone, "green");
  assert.equal(paymentStatusBadge("pending").tone, "orange");
});

test("statusStepperIndex maps pipeline and cancel", () => {
  assert.equal(statusStepperIndex("pending"), 0);
  assert.equal(statusStepperIndex("dispatched"), 4);
  assert.equal(statusStepperIndex("canceled"), -1);
});

test("filterFoodOrders matches query and status", () => {
  const items = [
    sample(),
    sample({
      id: "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee",
      status: "delivered",
      client: {
        id: "client-2",
        full_name: "Omar Fall",
        email: "omar@example.com",
        phone: null,
        avatar_url: null,
        account_kind: "real",
      },
      created_at: "2026-07-10T12:00:00.000Z",
      total_cents: 4000,
    }),
  ];

  const byName = filterFoodOrders(items, {
    ...DEFAULT_FOOD_ORDER_FILTERS,
    q: "awa",
  });
  assert.equal(byName.length, 1);
  assert.equal(byName[0]!.client?.full_name, "Awa Diallo");

  const byStatus = filterFoodOrders(items, {
    ...DEFAULT_FOOD_ORDER_FILTERS,
    status: "delivered",
  });
  assert.equal(byStatus.length, 1);

  const byAmount = filterFoodOrders(items, {
    ...DEFAULT_FOOD_ORDER_FILTERS,
    minAmount: "30",
  });
  assert.equal(byAmount.length, 1);
  assert.equal(byAmount[0]!.id.startsWith("bbbb"), true);
});

test("sortFoodOrders by amount asc", () => {
  const items = [
    sample({ id: "a", total_cents: 5000 }),
    sample({ id: "b", total_cents: 1000 }),
  ];
  const sorted = sortFoodOrders(items, "amount", "asc");
  assert.equal(sorted[0]!.id, "b");
  assert.equal(sorted[1]!.id, "a");
});

test("URL filter round-trip", () => {
  const filters = {
    ...DEFAULT_FOOD_ORDER_FILTERS,
    q: "awa",
    status: "ready",
    sort: "amount" as const,
    dir: "asc" as const,
  };
  const params = filtersToSearchParams(filters);
  const parsed = parseFiltersFromSearchParams(params);
  assert.equal(parsed.q, "awa");
  assert.equal(parsed.status, "ready");
  assert.equal(parsed.sort, "amount");
  assert.equal(parsed.dir, "asc");
});

test("buildAdminFoodOrderParty prefers client_profiles name and avatar", () => {
  const party = buildAdminFoodOrderParty({
    profile: {
      id: "u1",
      full_name: null,
      email: "mmddelivery621@gmail.com",
      phone_e164: "+19297408722",
      avatar_url: "drivers/u1/avatar.jpg",
      account_kind: "real",
    },
    roleProfile: {
      user_id: "u1",
      full_name: "Mamadou Maladho",
      phone: "9297246222",
      avatar_url:
        "https://example.supabase.co/storage/v1/object/public/avatars/clients/u1/avatar.jpg",
    },
    preferRoleAvatar: true,
  });
  assert.equal(party?.full_name, "Mamadou Maladho");
  assert.equal(party?.email, "mmddelivery621@gmail.com");
  assert.equal(party?.phone, "+19297408722");
  assert.match(String(party?.avatar_url), /clients\/u1\/avatar\.jpg/);
});

test("sanitizeDisplayPhone drops placeholders", () => {
  assert.equal(sanitizeDisplayPhone("+1NUMERO_CLIENT"), null);
  assert.equal(sanitizeDisplayPhone("+19297408722"), "+19297408722");
});

test("partyDisplayName never returns generic Client when email exists", () => {
  assert.equal(
    partyDisplayName({
      id: "u1",
      full_name: null,
      email: "e2e.phase15@mmd.test",
      phone: null,
      avatar_url: null,
      account_kind: "test",
    }),
    "e2e.phase15@mmd.test"
  );
});

console.log("adminFoodOrderDisplay.test.ts passed");
