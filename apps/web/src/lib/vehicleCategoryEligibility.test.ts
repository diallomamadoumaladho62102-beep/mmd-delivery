import assert from "node:assert/strict";
import test from "node:test";
import {
  computeAllVehicleCategoryEligibility,
  computeVehicleCategoryEligibility,
  computeVehicleAge,
  DEFAULT_VEHICLE_CATEGORY_RULES,
  driverAcceptsService,
  hasAnyServiceEnabled,
  normalizeTaxiCategory,
  resolveVehicleCategoryRule,
} from "./vehicleCategoryEligibility";

const baseVehicle = {
  vehicle_year: 2022,
  seats_count: 4,
  vehicle_type: "sedan",
  has_air_conditioning: true,
  wheelchair_accessible: false,
  wheelchair_equipment_verified: false,
  inspection_status: "approved",
  insurance_status: "approved",
  registration_status: "approved",
  vehicle_active: true,
};

test("normalizeTaxiCategory maps premium to comfort", () => {
  assert.equal(normalizeTaxiCategory("premium"), "comfort");
  assert.equal(normalizeTaxiCategory("wheelchair"), "wheelchair_accessible");
});

test("driverAcceptsService respects preferences", () => {
  const prefs = {
    food_delivery_enabled: true,
    package_delivery_enabled: false,
    taxi_rides_enabled: true,
  };
  assert.equal(driverAcceptsService(prefs, "food"), true);
  assert.equal(driverAcceptsService(prefs, "package"), false);
  assert.equal(driverAcceptsService(prefs, "taxi"), true);
});

test("hasAnyServiceEnabled requires at least one toggle", () => {
  assert.equal(
    hasAnyServiceEnabled({
      food_delivery_enabled: false,
      package_delivery_enabled: false,
      taxi_rides_enabled: false,
    }),
    false,
  );
  assert.equal(
    hasAnyServiceEnabled({
      food_delivery_enabled: true,
      package_delivery_enabled: false,
      taxi_rides_enabled: false,
    }),
    true,
  );
});

test("Standard eligible at exactly 10 years", () => {
  const rule = DEFAULT_VEHICLE_CATEGORY_RULES.find((r) => r.category === "standard")!;
  const result = computeVehicleCategoryEligibility({
    vehicle: { ...baseVehicle, vehicle_year: 2016 },
    driverRating: 4.8,
    rule,
    currentYear: 2026,
  });
  assert.equal(result.status, "eligible");
});

test("Standard rejected at 11 years", () => {
  const rule = DEFAULT_VEHICLE_CATEGORY_RULES.find((r) => r.category === "standard")!;
  const result = computeVehicleCategoryEligibility({
    vehicle: { ...baseVehicle, vehicle_year: 2015 },
    driverRating: 4.8,
    rule,
    currentYear: 2026,
  });
  assert.equal(result.status, "expired_age");
});

test("Comfort eligible at exactly 5 years with admin approval", () => {
  const rule = DEFAULT_VEHICLE_CATEGORY_RULES.find((r) => r.category === "comfort")!;
  const result = computeVehicleCategoryEligibility({
    vehicle: { ...baseVehicle, vehicle_year: 2021 },
    driverRating: 4.8,
    rule,
    currentYear: 2026,
    adminApproved: true,
  });
  assert.equal(result.status, "eligible");
});

test("XL rejected at exactly 11 years", () => {
  const rule = DEFAULT_VEHICLE_CATEGORY_RULES.find((r) => r.category === "xl")!;
  const result = computeVehicleCategoryEligibility({
    vehicle: { ...baseVehicle, vehicle_year: 2015, seats_count: 7, vehicle_type: "suv" },
    driverRating: 4.8,
    rule,
    currentYear: 2026,
    adminApproved: true,
  });
  assert.equal(result.status, "expired_age");
});

test("Wheelchair rejected when admin denies verification", () => {
  const rule = DEFAULT_VEHICLE_CATEGORY_RULES.find(
    (r) => r.category === "wheelchair_accessible",
  )!;
  const result = computeVehicleCategoryEligibility({
    vehicle: {
      ...baseVehicle,
      wheelchair_accessible: true,
      wheelchair_equipment_verified: false,
    },
    driverRating: 4.8,
    rule,
    currentYear: 2026,
    adminApproved: true,
  });
  assert.equal(result.status, "wheelchair_not_verified");
});

test("resolveVehicleCategoryRule prefers city over global", () => {
  const rules = [
    ...DEFAULT_VEHICLE_CATEGORY_RULES.map((rule) => ({
      ...rule,
      country_code: null as string | null,
      city: null as string | null,
    })),
    {
      ...DEFAULT_VEHICLE_CATEGORY_RULES[0],
      country_code: "US",
      city: "brooklyn",
      max_vehicle_age_years: 8,
    } as typeof DEFAULT_VEHICLE_CATEGORY_RULES[0] & {
      country_code: string;
      city: string;
    },
  ];

  const resolved = resolveVehicleCategoryRule(rules as never, {
    countryCode: "US",
    city: "Brooklyn",
    category: "standard",
  });

  assert.equal(resolved?.max_vehicle_age_years, 8);
});

test("Standard eligible for 10 year old vehicle with 4 seats", () => {
  const rule = DEFAULT_VEHICLE_CATEGORY_RULES.find((r) => r.category === "standard")!;
  const result = computeVehicleCategoryEligibility({
    vehicle: { ...baseVehicle, vehicle_year: 2016 },
    driverRating: 4.8,
    rule,
    currentYear: 2026,
  });
  assert.equal(result.status, "eligible");
});

test("Standard rejected if vehicle older than 10 years", () => {
  const rule = DEFAULT_VEHICLE_CATEGORY_RULES.find((r) => r.category === "standard")!;
  const result = computeVehicleCategoryEligibility({
    vehicle: { ...baseVehicle, vehicle_year: 2015 },
    driverRating: 4.8,
    rule,
    currentYear: 2026,
  });
  assert.equal(result.status, "expired_age");
});

test("Comfort rejected if vehicle older than 5 years", () => {
  const rule = DEFAULT_VEHICLE_CATEGORY_RULES.find((r) => r.category === "comfort")!;
  const result = computeVehicleCategoryEligibility({
    vehicle: { ...baseVehicle, vehicle_year: 2020 },
    driverRating: 4.8,
    rule,
    currentYear: 2026,
    adminApproved: true,
  });
  assert.equal(result.status, "expired_age");
});

test("Comfort pending review without admin approval", () => {
  const rule = DEFAULT_VEHICLE_CATEGORY_RULES.find((r) => r.category === "comfort")!;
  const result = computeVehicleCategoryEligibility({
    vehicle: baseVehicle,
    driverRating: 4.8,
    rule,
    currentYear: 2026,
    adminApproved: false,
  });
  assert.equal(result.status, "pending_review");
});

test("XL rejected if less than 6 seats", () => {
  const rule = DEFAULT_VEHICLE_CATEGORY_RULES.find((r) => r.category === "xl")!;
  const result = computeVehicleCategoryEligibility({
    vehicle: { ...baseVehicle, seats_count: 5, vehicle_type: "suv" },
    driverRating: 4.8,
    rule,
    currentYear: 2026,
    adminApproved: true,
  });
  assert.equal(result.status, "insufficient_seats");
});

test("XL eligible for suv with 6+ seats under 10 years", () => {
  const rule = DEFAULT_VEHICLE_CATEGORY_RULES.find((r) => r.category === "xl")!;
  const result = computeVehicleCategoryEligibility({
    vehicle: { ...baseVehicle, seats_count: 7, vehicle_type: "suv", vehicle_year: 2018 },
    driverRating: 4.8,
    rule,
    currentYear: 2026,
    adminApproved: true,
  });
  assert.equal(result.status, "eligible");
});

test("Wheelchair rejected without verified equipment", () => {
  const rule = DEFAULT_VEHICLE_CATEGORY_RULES.find(
    (r) => r.category === "wheelchair_accessible",
  )!;
  const result = computeVehicleCategoryEligibility({
    vehicle: {
      ...baseVehicle,
      wheelchair_accessible: true,
      wheelchair_equipment_verified: false,
    },
    driverRating: 4.8,
    rule,
    currentYear: 2026,
    adminApproved: true,
  });
  assert.equal(result.status, "wheelchair_not_verified");
});

test("Wheelchair eligible when equipment verified and admin approved", () => {
  const rule = DEFAULT_VEHICLE_CATEGORY_RULES.find(
    (r) => r.category === "wheelchair_accessible",
  )!;
  const result = computeVehicleCategoryEligibility({
    vehicle: {
      ...baseVehicle,
      wheelchair_accessible: true,
      wheelchair_equipment_verified: true,
    },
    driverRating: 4.8,
    rule,
    currentYear: 2026,
    adminApproved: true,
  });
  assert.equal(result.status, "eligible");
});

test("missing documents blocks dispatch eligibility", () => {
  const rule = DEFAULT_VEHICLE_CATEGORY_RULES.find((r) => r.category === "standard")!;
  const result = computeVehicleCategoryEligibility({
    vehicle: { ...baseVehicle, insurance_status: "pending" },
    driverRating: 4.8,
    rule,
    currentYear: 2026,
  });
  assert.equal(result.status, "missing_documents");
});

test("recalculates when year changes across age threshold", () => {
  const rule = DEFAULT_VEHICLE_CATEGORY_RULES.find((r) => r.category === "comfort")!;
  const vehicle = { ...baseVehicle, vehicle_year: 2021 };
  assert.equal(
    computeVehicleCategoryEligibility({
      vehicle,
      driverRating: 4.8,
      rule,
      currentYear: 2026,
      adminApproved: true,
    }).status,
    "eligible",
  );
  assert.equal(
    computeVehicleCategoryEligibility({
      vehicle,
      driverRating: 4.8,
      rule,
      currentYear: 2027,
      adminApproved: true,
    }).status,
    "expired_age",
  );
});

test("admin suspension overrides eligible category", () => {
  const rule = DEFAULT_VEHICLE_CATEGORY_RULES.find((r) => r.category === "standard")!;
  const result = computeVehicleCategoryEligibility({
    vehicle: baseVehicle,
    driverRating: 4.8,
    rule,
    currentYear: 2026,
    adminSuspended: true,
  });
  assert.equal(result.status, "suspended");
});

test("computeAllVehicleCategoryEligibility returns four categories", () => {
  const results = computeAllVehicleCategoryEligibility({
    vehicle: baseVehicle,
    driverRating: 4.9,
    rules: DEFAULT_VEHICLE_CATEGORY_RULES,
    currentYear: 2026,
    adminApprovedCategories: {
      standard: true,
      comfort: true,
      xl: true,
      wheelchair_accessible: true,
    },
  });
  assert.equal(results.length, 4);
  assert.equal(computeVehicleAge(2022, 2026), 4);
});
