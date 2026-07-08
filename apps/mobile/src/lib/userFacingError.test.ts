import assert from "node:assert/strict";
import { isTechnicalErrorMessage, toUserFacingError } from "./userFacingError";

function testTechnicalPatterns() {
  assert.equal(isTechnicalErrorMessage("unrecognized format() type specifier"), true);
  assert.equal(isTechnicalErrorMessage("Mapbox directions failed (422)"), true);
  assert.equal(isTechnicalErrorMessage("Request failed (500)"), true);
}

function testKnownCodes() {
  assert.equal(
    toUserFacingError({ error: "documents_required" }),
    "Ce mode de transport nécessite une validation de vos documents avant d'être activé.",
  );
}

function testStripeGenericFrench() {
  assert.equal(
    toUserFacingError({ message: "Une erreur de traitement est survenue." }),
    "Le paiement n'a pas pu être finalisé. Réessayez dans quelques instants.",
  );
}

testTechnicalPatterns();
testKnownCodes();
testStripeGenericFrench();

console.log("userFacingError.test.ts OK");
