import assert from "node:assert/strict";
import {
  buildAdminClientsSearchOr,
  isAdminClientSearchUuid,
  sanitizeAdminClientSearchTerm,
} from "./adminClientSearch";

{
  assert.equal(isAdminClientSearchUuid("abdourahdiallo1983@gmail.com"), false);
  assert.equal(isAdminClientSearchUuid("abdourahdiallo1983@gmail.coma"), false);
  assert.equal(isAdminClientSearchUuid("Mamoudou"), false);
  assert.equal(isAdminClientSearchUuid("+224620000000"), false);
  assert.equal(
    isAdminClientSearchUuid("550e8400-e29b-41d4-a716-446655440000"),
    true,
  );
}

{
  const emailOr = buildAdminClientsSearchOr("abdourahdiallo1983@gmail.coma");
  assert.ok(emailOr);
  assert.doesNotMatch(emailOr!, /id\.eq\./);
  assert.match(emailOr!, /email\.ilike\.%abdourahdiallo1983@gmail\.coma%/);
  assert.match(emailOr!, /full_name\.ilike\./);
  assert.match(emailOr!, /phone\.ilike\./);
}

{
  const nameOr = buildAdminClientsSearchOr("Abdourah Diallo");
  assert.ok(nameOr);
  assert.doesNotMatch(nameOr!, /id\.eq\./);
  assert.match(nameOr!, /full_name\.ilike\.%Abdourah Diallo%/);
}

{
  const phoneOr = buildAdminClientsSearchOr("+1 (929) 740-8722");
  assert.ok(phoneOr);
  assert.doesNotMatch(phoneOr!, /id\.eq\./);
  assert.match(phoneOr!, /phone_e164\.ilike\./);
  assert.match(phoneOr!, /9297408722/);
}

{
  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  assert.equal(buildAdminClientsSearchOr(uuid), `id.eq.${uuid}`);
}

{
  assert.equal(buildAdminClientsSearchOr("   "), null);
  assert.equal(sanitizeAdminClientSearchTerm("a%b_c,d"), "a b c d");
}

console.log("adminClientSearch tests passed");
