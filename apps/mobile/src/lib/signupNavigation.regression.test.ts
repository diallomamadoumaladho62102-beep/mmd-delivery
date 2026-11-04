import assert from "node:assert/strict";
import {
  buildDriverProfileFromSignupMetadata,
  isApprovedDriverStatus,
  pendingDriverMayStayOn,
  selectedSellerAppliesToProfile,
} from "./signupNavigation";

assert.equal(selectedSellerAppliesToProfile("client"), true);
assert.equal(selectedSellerAppliesToProfile("seller"), true);
assert.equal(selectedSellerAppliesToProfile(null), true);
assert.equal(selectedSellerAppliesToProfile("driver"), false);
assert.equal(selectedSellerAppliesToProfile("restaurant"), false);
assert.equal(selectedSellerAppliesToProfile("super_admin"), false);

assert.equal(isApprovedDriverStatus("approved"), true);
assert.equal(isApprovedDriverStatus("pending"), false);
assert.equal(isApprovedDriverStatus("rejected"), false);
assert.equal(isApprovedDriverStatus(null), false);

assert.equal(pendingDriverMayStayOn("DriverOnboarding"), true);
assert.equal(pendingDriverMayStayOn("DriverVehicles"), true);
assert.equal(pendingDriverMayStayOn("RoleSelect"), true);
assert.equal(pendingDriverMayStayOn("DriverTabs"), false);
assert.equal(pendingDriverMayStayOn("ClientHome"), false);

const incompleteCar = buildDriverProfileFromSignupMetadata("user-1", {
  role: "driver",
  full_name: "Awa Diallo",
  phone: "+19295550100",
  city: "New York",
  transport_mode: "car",
  license_number: "D123",
});
assert.equal(incompleteCar?.status, "pending");
assert.equal(incompleteCar?.full_name, "Awa Diallo");
// Incomplete car metadata must fall back to bike to satisfy vehicle_fields_check.
assert.equal(incompleteCar?.transport_mode, "bike");
assert.equal(incompleteCar?.vehicle_brand, null);

const completeCar = buildDriverProfileFromSignupMetadata("user-2", {
  role: "driver",
  full_name: "Mamadou Diallo",
  phone: "+19295550101",
  transport_mode: "car",
  license_number: "NY123456",
  vehicle_brand: "Toyota",
  vehicle_model: "Corolla",
  plate_number: "abc1234",
  vehicle_year: "2019",
  vehicle_color: "Black",
});
assert.equal(completeCar?.transport_mode, "car");
assert.equal(completeCar?.vehicle_brand, "Toyota");
assert.equal(completeCar?.vehicle_model, "Corolla");
assert.equal(completeCar?.plate_number, "ABC1234");
assert.equal(completeCar?.license_number, "NY123456");
assert.equal(completeCar?.vehicle_year, 2019);

assert.equal(buildDriverProfileFromSignupMetadata("user-1", { role: "client", full_name: "A", phone: "1" }), null);
assert.equal(buildDriverProfileFromSignupMetadata("user-1", { role: "super_admin", full_name: "A", phone: "1" }), null);

console.log("signupNavigation.regression.test.ts ok");
