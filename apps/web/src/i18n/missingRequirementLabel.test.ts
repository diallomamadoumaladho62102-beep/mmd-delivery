import assert from "node:assert/strict";
import {
  missingRequirementLabel,
  missingRequirementSource,
  missingRequirementsSummary,
} from "./missingRequirementLabel";
import { localizeIdentityWaitSla, orderStatusUiLabel } from "./orderStatusUi";

const identity = (source: string) => source;

test("maps internal keys to French catalog sources", () => {
  assert.equal(missingRequirementSource("full name"), "Nom complet");
  assert.equal(missingRequirementSource("profile photo"), "Photo personnelle");
  assert.equal(missingRequirementSource("ID card front"), "Pièce d’identité recto");
  assert.equal(missingRequirementSource("active vehicle"), "Véhicule actif");
});

test("unknown internal keys stay as-is", () => {
  assert.equal(missingRequirementSource("phone_verified"), "phone_verified");
});

test("translates via t()", () => {
  const t = (source: string) => (source === "Nom complet" ? "Full name" : source);
  assert.equal(missingRequirementLabel("full name", t), "Full name");
});

test("summary prefixes localized Missing", () => {
  const t = (source: string) => {
    if (source === "Missing") return "Manquant";
    if (source === "Nom complet") return "Full name";
    return source;
  };
  assert.equal(missingRequirementsSummary(["full name"], t), "Manquant: Full name");
});

test("order status enums become UI labels", () => {
  assert.equal(orderStatusUiLabel("pending", identity), "En attente");
  assert.equal(orderStatusUiLabel("delivered", identity), "Livrée");
  assert.equal(orderStatusUiLabel("pending_internal_xyz", identity), "pending_internal_xyz");
});

test("wait SLA interpolates after translating the prefix", () => {
  const t = (source: string) =>
    source === "En attente depuis" ? "Waiting for" : source;
  assert.equal(localizeIdentityWaitSla("En attente depuis 20 min", t), "Waiting for 20 min");
  assert.equal(localizeIdentityWaitSla("En attente depuis 2 h", t), "Waiting for 2 h");
});

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

console.log("missingRequirementLabel.test.ts OK");
