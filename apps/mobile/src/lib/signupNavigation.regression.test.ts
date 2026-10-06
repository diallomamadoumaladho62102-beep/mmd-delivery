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

const restored = buildDriverProfileFromSignupMetadata("user-1", {
  role: "driver",
  full_name: "Awa Diallo",
  phone: "+19295550100",
  city: "New York",
  transport_mode: "car",
  license_number: "D123",
});
assert.equal(restored?.status, "pending");
assert.equal(restored?.full_name, "Awa Diallo");
assert.equal(restored?.vehicle_brand, null);
assert.equal(buildDriverProfileFromSignupMetadata("user-1", { role: "client", full_name: "A", phone: "1" }), null);
assert.equal(buildDriverProfileFromSignupMetadata("user-1", { role: "super_admin", full_name: "A", phone: "1" }), null);

console.log("signupNavigation.regression.test.ts ok");
