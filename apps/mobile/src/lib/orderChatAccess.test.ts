import assert from "node:assert/strict";
import test from "node:test";

import {
  canRoleAccessChatResource,
  normalizeChatSourceTable,
  resolveChatTargetUserId,
} from "./orderChatAccess";

test("normalizeChatSourceTable keeps marketplace jobs", () => {
  assert.equal(
    normalizeChatSourceTable("marketplace_delivery_jobs"),
    "marketplace_delivery_jobs",
  );
});

test("canRoleAccessChatResource allows marketplace driver", () => {
  const allowed = canRoleAccessChatResource({
    userId: "driver-1",
    role: "driver",
    participantIds: {
      clientId: "client-1",
      driverId: "driver-1",
      restaurantUserId: "seller-1",
      restaurantLabel: "Shop",
      blocked: false,
    },
  });

  assert.equal(allowed, true);
});

test("resolveChatTargetUserId maps restaurant to seller user", () => {
  assert.equal(
    resolveChatTargetUserId(
      {
        clientId: "client-1",
        driverId: "driver-1",
        restaurantUserId: "seller-1",
        restaurantLabel: "Shop",
        blocked: false,
      },
      "restaurant",
    ),
    "seller-1",
  );
});
